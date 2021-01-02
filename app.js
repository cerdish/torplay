const Vue = require('vue/dist/vue.min.js')
const http = require('http');
const address = require('network-address')
const ChromecastAPI = require('chromecast-api')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const _ = require('lodash')
const mime = require('mime')
const srt2vtt = require('srt-to-vtt')

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
        currentCcIndex:0,
        seekTo:0,
        statusInterval:false,
        currentPlayhead:0,
        currentDuration:0
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
            localStorage.playlist=JSON.stringify(this.playlist)
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
            //if there is already a device set (not local machine) close that connection
            if(oldDevice) oldDevice.close()

            if(newDevice){
                if(!this.isServerRunning) this.startMediaDelivery(this.currentMedia)
                
                newDevice._tryJoin(function(){
                    if(newDevice.player) newDevice.getStatus(function(e,s){
                        console.log(s)
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
            //save the current device name in the vue scope and in local storage for later retrieval
            this.currentDeviceName = localStorage.currentDeviceName = name
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

            this.addMediaToPlaylist({torrentUrl:this.torrentUrl,filename:filename,subtitles:subtitles})
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
        selectMedia:function(mediaIndex){
            this.currentPlaylistIndex=mediaIndex
            this.currentCCIndex=0
            this.currentPlayhead=0
            this.currentDuration=0

            this.startMediaDelivery(this.playlist[mediaIndex],true)
        },
        startMediaDelivery:function(media,isPlayMedia){
            var self=this

            //if(this.currentDevice) this.currentDevice.close()

            if(media.torrentUrl){
                readTorrent(media.torrentUrl,function(e,torrent){
                    if(e) console.log(e)

                    self.resetMediaDelivery()
                    
                    torrentEngine=torrentStream(torrent)
    
                    torrentEngine.on('ready',function(){
                        var mediaFile=_.find(torrentEngine.files,{name:media.filename})

                        var srtFiles={}
                        var srtFile=_.find(torrentEngine.files,function(f){
                            var filename=media.filename.substr(0,media.filename.lastIndexOf("."))
                            var ext=mime.getExtension(mime.getType(f.name))
                            
                            return ext=="srt"&&f.name.indexOf(filename)>-1
                        })

                        server=http.createServer(function(req, res){
                            var filename=decodeURI(req.url.substr(req.url.lastIndexOf("/")+1,req.url.length))
                            var type=mime.getType(req.url)
                            var ext=mime.getExtension(type)

                            console.log(filename)
                            
                            if(ext=='srt'&&media.subtitles.indexOf(filename)>-1){
                                console.log("piping srt")
                                
                                res.setHeader("Access-Control-Allow-Origin","*")
                                res.setHeader("Content-Type","text/plain")

                                if(!srtFiles[filename]) srtFiles[filename]=_.find(torrentEngine.files,{name:filename})
                                
                                var srtStream=srtFiles[filename].createReadStream()

                                srtStream.pipe(srt2vtt()).pipe(res)
                            }else if(SUPPORTED_FORMATS.indexOf(ext)>-1&&filename==media.filename){
                                console.log("piping media")

                                var mediaStream=mediaFile.createReadStream()
                                
                                mediaStream.pipe(res)
                            }else{
                                console.log("not found")
                                res.end()
                            }
                            
                        })
                        
                        server.on('connection', function (socket) {
                            socket.setTimeout(36000000)
                        })

                        server.listen(8080,function(){
                            if(isPlayMedia) self.playMedia(media)
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

                console.log(chromecastMedia)

                this.currentDevice.play(chromecastMedia,function(e,s){
                    console.log(e,s)
                })
                
                this.currentDevice.on("status",function(s){
                    console.log(s)
                })

                this.currentDevice.on("finished",function(){
                    if(self.currentPlaylistIndex<self.playlist.length-1){
                        self.selectMedia(self.currentPlaylistIndex+1)
                    }
                })
            }
        },
        resetMediaDelivery:function(){
            var self=this

            if(torrentEngine) torrentEngine.destroy()
            if(server) server.close(function(){
                self.isServerRunning=false
            })

            torrentEngine=false
            server=false
        },
        getMediaDeliveryPath:function(filename){
            return "http://" + address() + ":8080/" + filename
        }
    },
    beforeMount:function(){
        var self=this

        //add devices to device list
        clientDiscovery.on('device',function(device){
            self.devices=clientDiscovery.devices
        })

        //startup the status interval
        this.statusInterval=setInterval(function(){
            if(self.currentDevice&&self.currentDevice.player&&self.currentDevice.player.client){
                self.currentDevice.player.getStatus(function(e,s){
                    if(e) console.log(e)
                    else if(s){
                        self.currentPlayhead=s.currentTime
                        if(s.media) self.currentDuration=s.media.duration
                    }
                })
            }
        },STATUS_INTERVAL_DURATION)
    }
})