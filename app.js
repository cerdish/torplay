const Vue = require('vue/dist/vue.min.js')
const http = require('http');
const address = require('network-address')
const ChromecastAPI = require('chromecast-api')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const _ = require('lodash')
const mime = require('mime')
const srt2vtt = require('srt-to-vtt');
const { forEach } = require('lodash');
const parseRange = require('range-parser')

//supported file formats for chromecast
const SUPPORTED_FORMATS=["mp4","m4v","webm","mkv"]
const STATUS_INTERVAL_DURATION=1000

//this is the client we use to detect chromecast devices
const clientDiscovery = new ChromecastAPI()

//we use this var to store the torrent engine
var torrentEngine=false
//this stores the server instance that server the media files to the devices
var server=false

//init the vue app
const app=new Vue({
    el:"#app",
    data:{
        devices:[],
        currentDeviceName:localStorage.currentDeviceName || "", //device name is used as a key to find the current device
        playlist:JSON.parse(localStorage.playlist||"[]"),
        currentPlaylistIndex:localStorage.currentPlaylistIndex || -1,
        torrentUrl:localStorage.torrentUrl || "",
        isAddFromTorrent:false,
        torrentFiles:[],
        selectedTorrentFiles:[],
        mediaDeliveryPath:"",
        isServerRunning:false,
        currentCcIndex:-1,
        seekTo:0,
        statusInterval:false,
        playbackRate:1,
        currentDeviceStatus:"DISCONNECTED",
        currentServerStatus:"STOPPED"
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
        _torrentFiles:function(){
            return _.filter(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))

                return SUPPORTED_FORMATS.indexOf(ext)>-1
            })
        },
        currentMedia:function(){
            if(this.currentPlaylistIndex>-1&&this.currentPlaylistIndex<this.playlist.length) return this.playlist[this.currentPlaylistIndex]

            return false
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

            //if there is already a device set (not local machine) close that connection
            if(oldDevice) oldDevice.close()

            if(newDevice){
                if(!this.isServerRunning) this.startMediaDelivery(this.currentMedia)
                
                newDevice._tryJoin(function(){
                    if(newDevice.player) newDevice.getStatus(function(e,s){
                        console.log(s)
                        if(s) self.currentDeviceStatus=s.playerState
                    })
                })
            }

            console.log(this.currentDevice)
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
    
                    if(self.currentPlaylistIndex<self.playlist.length-1){
                        console.log("playing next item in playlist")
    
                        self.currentMedia.currentTime=0
    
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
        getTorrentFileList:function(url){
            var self=this

            //reset selection
            this.selectedTorrentFiles=[]

            readTorrent(url,function(e,torrent){
                var torEng=torrentStream(torrent)

                //add allowed file types to the file list to show the user to select from
                torEng.on('ready',function(){
                    self.torrentFiles=torEng.files

                    torEng.destroy()
                })
            })

            localStorage.torrentUrl=this.torrentUrl
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

            this.isAddFromTorrent=false;
        },
        addAllTorrentFiles:function(){
            for(var i=0;i<this._torrentFiles.length;i++){
                this.addTorrentFileToPlaylist(this._torrentFiles[i].name)
            }

            this.isAddFromTorrent=false;
        },
        addTorrentFileToPlaylist:function(filename){
            var noExtName=filename.substr(0,filename.lastIndexOf("."))

            var subtitles=_.map(_.filter(this.torrentFiles,function(f){
                var ext=mime.getExtension(mime.getType(f.name))
                
                return ext=="srt"&&f.name.indexOf(noExtName)>-1
            }),function(f){
                return f.name
            })

            this.addMediaToPlaylist({torrentUrl:this.torrentUrl,filename:filename,subtitles:subtitles,currentTime:0,duration:0})
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
        selectMedia:function(mediaIndex){
            this.currentPlaylistIndex=mediaIndex
            this.currentCCIndex=-1
            this.playbackRate=1

            console.log("selecting media: "+mediaIndex)

            this.startMediaDelivery(this.playlist[mediaIndex],true)
        },
        startMediaDelivery:function(media,isPlayMedia){
            var self=this

            console.log("startingServer for: ",media)

            if(media.torrentUrl){
                readTorrent(media.torrentUrl,function(e,torrent){
                    if(e) console.log(e)

                    self.resetMediaDelivery()
                    
                    torrentEngine=torrentStream(torrent)
    
                    torrentEngine.on('ready',function(){
                        var mediaFile=_.find(torrentEngine.files,{name:media.filename})

                        var srtFiles={}

                        server=http.createServer(function(req, res){
                            var filename=decodeURI(req.url.substr(req.url.lastIndexOf("/")+1,req.url.length))
                            var type=mime.getType(req.url)
                            var ext=mime.getExtension(type)

                            console.log(filename)
                            
                            if(ext=='srt'&&media.subtitles.indexOf(filename)>-1){
                                console.log("piping srt")
                                
                                res.setHeader("Access-Control-Allow-Origin","*")
                                res.setHeader("Content-Type","text/vtt")
                                
                                if(!srtFiles[filename]) srtFiles[filename]=_.find(torrentEngine.files,{name:filename})
                                
                                var srtStream=srtFiles[filename].createReadStream()
                                
                                srtStream.pipe(srt2vtt()).pipe(res)
                            }else if(SUPPORTED_FORMATS.indexOf(ext)>-1&&filename==media.filename){
                                console.log("piping media")

                                var mediaStream
                                
                                res.setHeader("Content-Type",type)
                                
                                //set the response headers for byte ranges, this is required for seeking
                                res.setHeader("Accept-Ranges","bytes")
                                
                                var range=req.headers.range ? parseRange(mediaFile.length,req.headers.range)[0] : false
                                var contentLength=mediaFile.length

                                if(range){
                                    contentLength=range.end-range.start+1
                                    res.setHeader('Content-Range','bytes '+range.start+'-'+range.end+'/'+mediaFile.length)
                                    res.statusCode=206

                                    console.log(range)
                                    
                                    mediaStream=mediaFile.createReadStream(range)
                                }else{
                                    mediaStream=mediaFile.createReadStream()
                                }

                                res.setHeader('Content-Length',contentLength)
                                
                                
                                mediaStream.pipe(res)
                            }else{
                                console.log("not found: "+filename)
                                res.end()
                            }
                        })
                        
                        server.on('connection', function (socket) {
                            socket.setTimeout(36000000)
                        })

                        server.listen(8080,function(){
                            if(isPlayMedia) self.playMedia(media)
                            console.log("server is listening",encodeURI(self.getMediaDeliveryPath(media.filename)))
                            self.isServerRunning=true
                        })
                    })
                })
            }
        },
        playMedia:function(media){
            var self=this
            var mediaDeliveryPath=this.getMediaDeliveryPath(media.filename)
    
            if(this.currentDevice){
                var chromecastMedia={
                    url:mediaDeliveryPath,
                    subtitles:media.subtitles.length ? _.map(media.subtitles,function(s){
                        return {
                            url:self.getMediaDeliveryPath(s)
                        }
                    }) : [{
                        url:self.getMediaDeliveryPath("no-srt.srt")
                    }]
                }

                console.log(media.currentTime)

                this.currentDevice.play(chromecastMedia,{
                    startTime:media.currentTime || 0
                })
            }
        },
        resetMediaDelivery:function(){
            var self=this

            if(torrentEngine) torrentEngine.destroy()
            if(server) server.close(function(){
                console.log("server closed")
            })

            self.isServerRunning=false

            torrentEngine=false
            server=false
        },
        getMediaDeliveryPath:function(filename){
            return "http://" + address() + ":8080/" + filename
        },
        startInterval:function(){
            var self=this

            clearInterval(this.statusInterval)
            
            this.statusInterval=setInterval(function(){
                if(self.currentDevice&&self.currentDevice.player&&self.currentDevice.player.client){
                    self.currentDevice.player.getStatus(function(e,s){
                        if(e) console.log(e)
    
                        if(s&&self.currentMedia&&s.media){
                            self.currentMedia.currentTime=s.currentTime
                            self.currentMedia.duration=s.media.duration
    
                            self.storePlaylist()
                        }
                    })
                }
            },STATUS_INTERVAL_DURATION)
        },
        activateSubtitle:function(index){
            var vidEl=this.$refs.vidEl

            if(vidEl){
                for(var i=0;i<vidEl.textTracks.length;i++){
                    if(i==index) vidEl.textTracks[i].mode="showing"
                    else vidEl.textTracks[i].mode="hidden"
                }
            }
        }
    },
    beforeMount:function(){
        var self=this

        //add devices to device list
        clientDiscovery.on('device',function(device){
            self.devices=clientDiscovery.devices

            if(device.name==self.currentDeviceName){
                self.selectDevice(device.name)
            }
        })

        //startup the status interval (this gets the status of the chromecast so we can display the current time accurately)
        this.startInterval()
    }
})