const Vue = require('vue/dist/vue.min.js')
const ChromecastAPI = require('chromecast-api')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const _ = require('lodash')
const mime = require('mime')
const seconds2timecode = require('seconds2timecode')
const validUrl = require('valid-url')
const url = require('url')
const torplayServer = require('./tp-server.js')
const PlaylistManager = require('./tp-playlist-manager.js')
const axios = require('axios')

//supported file formats for chromecast
const STATUS_INTERVAL_DURATION=1000

//this is the client we use to detect chromecast devices
const deviceDiscovery = new ChromecastAPI()

//this is the http server instance we use to deliver media
const server=new torplayServer()
const playlistManager=new PlaylistManager()

//init the vue app
const app=new Vue({
    el:"#app",
    data:{
        server:server,
        devices:[],
        currentDeviceName:localStorage.currentDeviceName || "", //device name is used as a key to find the current device
        playlistManager:playlistManager,
        statusInterval:false,
        currentDeviceStatus:"DISCONNECTED",
        modal:false,
        mediaEditorIndex:-1,
        swarmStats:false
    },
    computed:{
        currentDevice:function(){
            if(!this.currentDeviceName) return false

            var device=_.find(this.devices,{name:this.currentDeviceName}) || ""

            return device
        },
        deviceNames:function(){
            var deviceList=this.devices.map(function(d){
                return d.name
            })

            deviceList.unshift("")

            return deviceList
        },
        playingMedia:function(){
            var playlists=this.playlistManager.playlists
            var media=false

            for(p of playlists){
                for(m of p.media){
                    if(m.isPlaying){
                        media=m
                        break
                    }
                }

                if(media) break
            }

            return media
        },
        isShowDeviceControls:function(){
            var status=this.currentDeviceStatus

            return ["PLAYING","BUFFERING","PAUSED","IDLE"].indexOf(status) > -1
        },
        isControlsDisabled:function(){
            var status=this.currentDeviceStatus

            return ["BUFFERING","IDLE"].indexOf(status) > -1
        },
        selectedPlaylist:function(){
            return _.find(this.playlistManager.playlists,{isSelected:true})
        }
    },
    watch:{
        torrentUrl:function(){
            //if this changes we rese the file list so that we dont add the wrong torrent url when adding media to the playlist
            this.torrentFiles=[]
        },
        currentDevice:function(newDevice,oldDevice){
            var self=this

            if(newDevice.name==oldDevice.name) return false

            //if there is already a device set (not local machine) close that connection
            if(oldDevice) this.closeDeviceConnection(oldDevice)

            clearInterval(this.statusInterval)

            if(newDevice){
                newDevice._tryJoin(function(){
                    if(newDevice.player) newDevice.getStatus(function(e,s){
                        if(s) self.currentDeviceStatus=s.playerState
                    })
                })

                //startup the status interval (this gets the status of the chromecast so we can display the current time accurately)
                this.startInterval()
            }

            console.log("device selected: "+this.getFriendlyName(newDevice))
        }
    },
    methods:{
        getFriendlyName:function(name){
            var device=_.find(this.devices,{name:name})

            return device ? device.friendlyName : "Local machine"
        },
        selectDevice:function(name){
            var self=this

            this.currentDeviceStatus="CONNECTING"

            var device=_.find(this.devices,{name:name})

            //if listeners don't exist add them
            if(device&&!device._events.status){
                console.log("adding listeners: ",device)

                device.on("connected",function(){
                    self.currentDeviceStatus="CONNECTED"
                })
                
                device.on("status",function(s){
                    console.log(s)
                    self.currentDeviceStatus=s.playerState
                })
    
                device.on("finished",function(){
                    console.log("media ended")

                    self.playingMedia.currentTime=0
                    self.playingMedia.isComplete=true

                    var playlist=self.playingMedia.getParent()
                    var mediaIndex=_.findIndex(playlist.media,{isPlaying:true})

                    self.playingMedia.isPlaying=false

                    if(mediaIndex<playlist.media.length-1){
                        console.log("playing next item in playlist")
    
                        self.selectMedia(self.playlistManager.getMedia(mediaIndex+1))
                    }else{
                        self.playlistManager.storePlaylists()
                    }
                })
            }

            //save the current device name in the vue scope and in local storage for later retrieval
            this.currentDeviceName = localStorage.currentDeviceName = name
        },
        closeDeviceConnection:function(device){
            var self=this

            device.close(function(e){
                self.currentDeviceStatus="DISCONNECTED"
            })
        },
        selectMedia:function(media){
            this.playlistManager.selectItem(media)

            this.playMedia(media)
        },
        playMedia:function(media){
            var self=this
            var media=this.playlistManager.playMedia(media)
            var mediaDeliveryPath=this.getDeliveryPath(media)
            
            //if we are very close to the end of the file we should start the playback over
            if(media.duration&&media.currentTime>media.duration-5) media.currentTime=0

            if(this.currentDevice){
                var chromecastMedia={
                    url:mediaDeliveryPath
                }

                if(media.subtitles.length) chromecastMedia.subtitles=_.map(media.subtitles,function(s){
                    return {
                        url:self.getDeliveryPath(s)
                    }
                })

                this.currentDeviceStatus="CONNECTING"

                console.log("sending to chromecast: ",chromecastMedia)

                this.currentDevice.play(chromecastMedia,{
                    startTime:media.currentTime || 0
                },function(err){
                    if(err) console.log("chromecast error: ",err)
                    
                    var sIndex=_.findIndex(media.subtitles,{isSelected:true})

                    self.changeSubtitles(sIndex,media)
                })
            }
        },
        changeSubtitles:function(sIndex,media){
            sIndex=sIndex*1

            if(sIndex==-1) this.currentDevice.subtitlesOff()
            else{
                this.currentDevice.changeSubtitles(sIndex)
    
                this.playlistManager.selectItem(media.subtitles[sIndex])
            }
        },
        getDeliveryPath:function(file){
            return this.server.getDeliveryPath(file)
        },
        startInterval:function(){
            var self=this

            clearInterval(this.statusInterval)
            
            this.statusInterval=setInterval(function(){
                if(self.currentDevice&&self.currentDevice.player&&self.currentDevice.player.client){
                    self.currentDevice.player.getStatus(function(e,s){
                        if(e) console.log(e)
    
                        if(s&&self.playingMedia&&s.media){
                            self.playingMedia.currentTime=s.currentTime
                            self.playingMedia.duration=s.media.duration
    
                            self.playlistManager.storePlaylists()
                        }
                    })
                }
            },STATUS_INTERVAL_DURATION)
        },
        seconds2timecode:function(seconds){
            return seconds2timecode(seconds,2)
        },
        refreshDevices:function(){
            deviceDiscovery.update()
        },
        openModal:function(component,data){
            this.modal={
                component:component,
                data:data
            }
        },
        closeModal:function(){
            this.modal=false
        },
        getSwarmStats:function(){
            axios.get(server.getDeliveryPath({filename:"stats.json"})).then(function(r){
                this.swarmStats=r.data.swarmStats
            }.bind(this))
        }
    },
    mounted:function(){
        var self=this

        //add devices to device list
        deviceDiscovery.on('device',function(device){
            self.devices=deviceDiscovery.devices

            if(device.name==self.currentDeviceName){
                self.selectDevice(device.name)
            }
        })

        setInterval(function(){
            self.getSwarmStats()
        },1000)

        this.server.listen(8080)
    }
})

Vue.component('playlist',{
    template:"#playlist_template",
    data:function(){
        return {
            playlistManager:playlistManager
        }
    },
    computed:{
        selectedPlaylist:function(){
            return this.$root.selectedPlaylist
        }
    },
    methods:{
        editMedia:function(media){
            this.$root.openModal("editMedia",{media:media})
        }
    },
    props:["playlist"]
})

Vue.component('addTorrentMedia',{
    template:"#addTorrentMedia_template",
    data:function(){
        return {
            torrentUrl:"",
            torrentFiles:[],
            selectedTorrentFiles:[],
            busy:false,
            torrentUrlHistory:JSON.parse(localStorage.torrentUrlHistory||"[]"),
            isShowHistory:false,
            playlistManager:playlistManager
        }
    },
    computed:{
        _torrentFiles:function(){
            return _.filter(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))

                return server.SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1
            })
        }
    },
    methods:{
        getTorrentFileList:function(url){
            var self=this

            this.busy=true

            //reset selection
            this.selectedTorrentFiles=[]

            readTorrent(url,function(e,torrent){
                if(e){
                    self.busy=false
                    return false
                }

                var torEng=torrentStream(torrent)

                //add allowed file types to the file list to show the user to select from
                torEng.on('ready',function(){
                    self.torrentFiles=torEng.files
                    
                    console.log(_.map(self.torrentFiles,"name"))

                    torEng.destroy()

                    self.addTorrentUrlToHistory(url)

                    self.busy=false
                })
            })
        },
        addTorrentUrlToHistory:function(url){
            if(this.torrentUrlHistory.indexOf(url)==-1) this.torrentUrlHistory.unshift(url)

            this.torrentUrlHistory=this.torrentUrlHistory.slice(0,20)

            localStorage.torrentUrlHistory=JSON.stringify(this.torrentUrlHistory)
        },
        selectTorrentFile:function(filename){
            var i=this.selectedTorrentFiles.indexOf(filename)

            if(i>-1) this.selectedTorrentFiles.splice(i,1)
            else this.selectedTorrentFiles.push(filename)
        },
        addSelectedTorrentFiles:function(){
            for(var i=0;i<this.selectedTorrentFiles.length;i++){
                this.addTorrentFileToPlaylist(this.selectedTorrentFiles[i])
            }

            this.$root.closeModal()
        },
        addAllTorrentFiles:function(){
            this.selectedTorrentFiles=_.map(this._torrentFiles,"path")

            this.addSelectedTorrentFiles()
        },
        addTorrentFileToPlaylist:function(filename){
            var filenameNoExt=filename.substr(0,filename.lastIndexOf(".")).substring(filename.lastIndexOf("\\"))
            
            var self=this

            //find any subtitles
            var subtitles=_.filter(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))
                
                return server.SUPPORTED_CAPTION_FORMATS.indexOf(ext)>-1&&f.path.indexOf(filenameNoExt)>-1
            })
            
            //if the first search for subs comes up empty we return any subs we find
            if(!subtitles.length) var subtitles=_.filter(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))
                
                return server.SUPPORTED_CAPTION_FORMATS.indexOf(ext)>-1
            })

            console.log("subtitles found: ",_.map(subtitles,"path"))

            subtitles=_.map(subtitles,function(f){
                return {
                    filename:f.path,
                    torrentUrl:self.torrentUrl
                }
            })

            //find the poster
            var poster=_.find(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))

                return (f.name.indexOf("poster")>-1||f.path.indexOf(filenameNoExt)>-1) && server.SUPPORTED_IMAGE_FORMATS.indexOf(ext)>-1
            })

            //if nothing named poster we find any images we can
            if(!poster) poster=_.find(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))

                return server.SUPPORTED_IMAGE_FORMATS.indexOf(ext)>-1
            })

            if(poster) poster={
                filename:poster.path,
                torrentUrl:this.torrentUrl
            },console.log("poster found: ",poster.name)

            this.playlistManager.addMedia({torrentUrl:this.torrentUrl,filename:filename,subtitles:subtitles,poster:poster})
        }
    }
})

Vue.component('editMedia',{
    template:"#editMedia_template",
    data:function(){
        return {
            newSubtitlesUrl:"",
            playlistManager:playlistManager
        }
    },
    props:["media"],
    methods:{
        addSubtitles:function(subtitleUrl){
            if(validUrl.isUri(subtitleUrl)){
                var urlInfo=url.parse(subtitleUrl,true)

                console.log(urlInfo)

                this.media.subtitles.push({
                    filename:urlInfo.pathname.substr(urlInfo.pathname.lastIndexOf("/")+1)+(urlInfo.search || ""),
                    httpUrl:subtitleUrl
                })
            }
        },
        removeSubtitles:function(sIndex){
            this.media.subtitles.splice(sIndex,1)
        }
    },
    mounted:function(){
        this.$refs.subtitlesUl.addEventListener('drop', (e) => {
            e.preventDefault()
            e.stopPropagation()
        
            for(const f of e.dataTransfer.files){
                var type=mime.getType(f.path)
                var ext=mime.getExtension(type)
        
                if(server.SUPPORTED_CAPTION_FORMATS.indexOf(ext)>-1) this.media.subtitles.push({
                    filename:f.path.substr(f.path.lastIndexOf("\\")+1),
                    filePath:f.path
                })
            }
        })
        this.$refs.subtitlesUl.addEventListener('dragover', (e) => {
            e.preventDefault()
            e.stopPropagation()
        })
    }
})

Vue.component('add-playlist',{
    template:"#addPlaylist_template",
    data:function(){
        return {
            playlistManager:playlistManager,
            playlistName:""
        }
    }
})

Vue.component('local-video',{
    template:"#localVideo_template",
    data:function(){
        return {
            playlistManager:playlistManager
        }
    },
    props:["media"],
    methods:{
        activateSubtitles:function(index,media){
            //activate subtites for local player
            var vidEl=this.$refs.vidEl

            if(vidEl){
                for(var i=0;i<vidEl.textTracks.length;i++){
                    if(i==index) vidEl.textTracks[i].mode="showing"
                    else vidEl.textTracks[i].mode="hidden"
                }
            }

            if(index>-1) this.playlistManager.selectItem(media.subtitles[index])
            else this.playlistManager.deselectAll(media.subtitles)
        }
    }
})