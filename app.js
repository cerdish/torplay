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
const Playlists = require('./tp-playlists.js')

//supported file formats for chromecast
const STATUS_INTERVAL_DURATION=1000

//this is the client we use to detect chromecast devices
const deviceDiscovery = new ChromecastAPI()

//this is the http server instance we use to deliver media
const server=new torplayServer()
const playlists=new Playlists()

//init the vue app
const app=new Vue({
    el:"#app",
    data:{
        server:server,
        devices:[],
        currentDeviceName:localStorage.currentDeviceName || "", //device name is used as a key to find the current device
        playlists:playlists,
        playlist:JSON.parse(localStorage.playlist||"[]"),
        currentPlaylistIndex:localStorage.currentPlaylistIndex || -1,        
        currentCcIndex:-1,
        statusInterval:false,
        playbackRate:1,
        currentDeviceStatus:"DISCONNECTED",
        overlayComponent:false,
        mediaEditorIndex:-1
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
        currentMedia:function(){
            if(this.currentPlaylistIndex>-1&&this.currentPlaylistIndex<this.playlist.length) return this.playlist[this.currentPlaylistIndex]

            return false
        },
        isShowDeviceControls:function(){
            var status=this.currentDeviceStatus

            return ["PLAYING","BUFFERING","PAUSED","IDLE"].indexOf(status) > -1
        },
        isControlsDisabled:function(){
            var status=this.currentDeviceStatus

            return ["BUFFERING","IDLE"].indexOf(status) > -1
        }
    },
    watch:{
        torrentUrl:function(){
            //if this changes we rese the file list so that we dont add the wrong torrent url when adding media to the playlist
            this.torrentFiles=[]
        },
        playlist:function(){
            //when the playlist changes we store those changes in local storage
            this.storePlaylist()
        },
        currentPlaylistIndex:function(){
            //when the index changes we save that to local storage for when the user returns to the app later
            localStorage.currentPlaylistIndex=this.currentPlaylistIndex
        },
        currentCcIndex:function(){
            //if we change currnet cc index and there is a device set we change the cc index for that device
            if(this.currentDevice){
                if(this.currentCcIndex==-1) this.currentDevice.subtitlesOff()
                else this.currentDevice.changeSubtitles(this.currentCcIndex)
            }
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

                device.on("connected",function(s){
                    self.currentDeviceStatus="CONNECTED"
                })
                
                device.on("status",function(s){
                    self.currentDeviceStatus=s.playerState
                })
    
                device.on("finished",function(){
                    console.log("media ended")

                    self.currentMedia.currentTime=0
                    
                    if(self.currentPlaylistIndex<self.playlist.length-1){
                        console.log("playing next item in playlist")
    
                        self.selectMedia(1*self.currentPlaylistIndex+1)
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
        addMediaToPlaylist:function(media){
            this.playlist.push(media)
        },
        removeMediaFromPlaylist:function(mIndex){
            //if we are removing the currently selected media we unselect all media
            if(this.currentPlaylistIndex==mIndex) this.currentPlaylistIndex=-1
            //if the media we removing as above the currently selected media we have to move the selected media index up by 1
            else if(this.currentPlaylistIndex>mIndex) this.currentPlaylistIndex--

            this.playlist.splice(mIndex,1)
        },
        storePlaylist:function(){
            localStorage.playlist=JSON.stringify(this.playlist)
        },
        editMedia:function(mIndex){
            this.mediaEditorIndex=mIndex
            this.overlayComponent="editMedia"
        },
        selectMedia:function(mediaIndex){
            this.currentPlaylistIndex=mediaIndex
            this.currentCCIndex=-1
            this.playbackRate=1

            console.log("selecting media: "+mediaIndex)

            this.playMedia(this.playlist[this.currentPlaylistIndex])
        },
        playMedia:function(media){
            var self=this
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

                this.currentDevice.play(chromecastMedia,{
                    startTime:media.currentTime || 0
                })
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

                        var currentMedia=self.playlist[self.currentPlaylistIndex]
    
                        if(s&&self.currentMedia&&s.media){
                            currentMedia.currentTime=s.currentTime
                            currentMedia.duration=s.media.duration
    
                            self.storePlaylist()
                        }
                    })
                }
            },STATUS_INTERVAL_DURATION)
        },
        activateSubtitle:function(index){
            //activate subtites for local player
            var vidEl=this.$refs.vidEl

            if(vidEl){
                for(var i=0;i<vidEl.textTracks.length;i++){
                    if(i==index) vidEl.textTracks[i].mode="showing"
                    else vidEl.textTracks[i].mode="hidden"
                }
            }
        },
        seconds2timecode:function(seconds){
            return seconds2timecode(seconds,2)
        },
        refreshDevices:function(){
            deviceDiscovery.update()
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

        this.server.listen(8080)
    }
})

Vue.component('playlist',{
    template:"#playlist_template",
    data:function(){
        return {
            playlists:playlists
        }
    },
    methods:{

    },
    props:["playlist"],
    mounted:function(){
        this.$refs.playlistUl.addEventListener('drop', (e) => {
            e.preventDefault()
            e.stopPropagation()
        
            for(const f of e.dataTransfer.files){
                var type=mime.getType(f.path)
                var ext=mime.getExtension(type)
        
                if(server.SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1) this.$root.addMediaToPlaylist({
                    filename:f.path.substr(f.path.lastIndexOf("\\")+1),
                    filePath:f.path,
                    subtitles:[],
                    currentTime:0,
                    duration:0
                })
            }
        })
        this.$refs.playlistUl.addEventListener('dragover', (e) => {
            e.preventDefault()
            e.stopPropagation()
        })
    }
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
            isShowHistory:false
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

            this.torrentUrlHistory=this.torrentUrlHistory.slice(0,10)

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

            this.$root.overlayComponent=false;
        },
        addAllTorrentFiles:function(){
            this.selectedTorrentFiles=_.map(this._torrentFiles,"name")

            this.addSelectedTorrentFiles()
        },
        addTorrentFileToPlaylist:function(filename){
            var filenameNoExt=filename.substr(0,filename.lastIndexOf("."))
            
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

            console.log("subtitles found: ",_.map(subtitles,"name"))

            subtitles=_.map(subtitles,function(f){
                return {
                    filename:f.name,
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
                filename:poster.name,
                torrentUrl:this.torrentUrl
            },console.log("poster found: ",poster.name)

            this.$root.addMediaToPlaylist({torrentUrl:this.torrentUrl,filename:filename,subtitles:subtitles,currentTime:0,duration:0,poster:poster})
        }
    }
})

Vue.component('editMedia',{
    template:"#editMedia_template",
    data:function(){
        return {
            newSubtitlesUrl:""
        }
    },
    computed:{
        media:function(){
            var mIndex=this.$root.mediaEditorIndex

            if(mIndex>-1){
                var media=this.$root.playlist[mIndex]

                if(media) return media
            }

            return false
        }
    },
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