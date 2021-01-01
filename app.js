const Vue = require('vue/dist/vue.min.js')
const http = require('http');
const address = require('network-address')
const ChromecastAPI = require('chromecast-api')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const _ = require('lodash')

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
        mediaDeliveryPath:""
    },
    computed:{
        currentDevice:function(){
            if(!this.currentDeviceName) return false

            return _.find(this.devices,{name:this.currentDeviceName}) || ""
        },
        deviceNames:function(){
            var deviceList=this.devices.map(function(d){
                return d.name
            })

            deviceList.unshift("")

            return deviceList
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
        }
    },
    methods:{
        getFriendlyName:function(name){
            var device=_.find(this.devices,{name:name})

            return device ? device.friendlyName : "Local machine"
        },
        selectDevice:function(name){
            //if there is already a device set (not local machine) close that connection
            if(this.currentDevice) this.currentDevice.close();console.log(this.currentDevice);
            //save the current device name in the vue scope and in local storage for later retrieval
            this.currentDeviceName = localStorage.currentDeviceName = name
        },
        getTorrentFileList:function(url){
            var self=this

            //reset selection
            this.selectedTorrentFiles=[]

            readTorrent(url,function(e,torrent){
                var torEng=torrentStream(torrent)

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
                this.addMediaToPlaylist({torrentUrl:this.torrentUrl,filename:this.selectedTorrentFiles[i]})
            }

            this.isAddFromTorrent=false;
        },
        addAllTorrentFiles:function(){
            for(var i=0;i<this.torrentFiles.length;i++){
                this.addMediaToPlaylist({torrentUrl:this.torrentUrl,filename:this.torrentFiles[i].name})
            }

            this.isAddFromTorrent=false;
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

            localStorage.currentPlaylistIndex=mediaIndex
        },
        playMedia:function(media){
            var self=this

            console.log(media)

            if(media.torrentUrl){
                readTorrent(media.torrentUrl,function(e,torrent){
                    if(e) console.log(e)
                    console.log(torrent)

                    self.resetMediaDelivery()
                    
                    torrentEngine=torrentStream(torrent)
    
                    torrentEngine.on('ready',function(){
                        var file=_.find(torrentEngine.files,{name:media.filename})

                        var stream=file.createReadStream()

                        console.log(stream)
                        console.log(file)

                        server=http.createServer(function(req, res){
                            stream.pipe(res)
                        })
                        
                        server.on('connection', function (socket) {
                            socket.setTimeout(36000000)
                        })

                        server.listen(8080,function(){
                            var mediaDeliveryPath=self.getMediaDeliveryPath(file.name)
    
                            if(self.currentDevice) self.currentDevice.play(mediaDeliveryPath)
    
                            self.mediaDeliveryPath=mediaDeliveryPath
                        })
                    })
                })
            }
        },
        resetMediaDelivery:function(){
            if(torrentEngine) torrentEngine.destroy()
            if(server) server.close()

            torrentEngine=false
            server=false
        },
        getMediaDeliveryPath:function(filename){
            return "http://" + address() + ":8080/" + filename
        },
        /*initMedia:function(mediaUrl){
            var self=this

            if(torrentEngine){
                if(torrentEngine.server) torrentEngine.server.close()

                torrentEngine.destroy()
            }
            
            torrentEngine=torrentStream(mediaUrl)

            torrentEngine.on('ready',function(){
                self.torrentFiles=torrentEngine.files
                console.log(torrentEngine.files)
                //console.log('filename:', file.name)
                //var stream = file.createReadStream();
                // stream is readable stream to containing the file content
            });

            localStorage.mediaUrl=this.mediaUrl
        },
        streamTorrentFile:function(file){
            var stream=file.createReadStream()

            console.log(stream)
            console.log(file)

            if(torrentEngine.server) torrentEngine.server.close()

            torrentEngine.server=http.createServer(function(req, res){
                stream.pipe(res)
            })
            
            torrentEngine.server.on('connection', function (socket) {
                socket.setTimeout(36000000)
            })

            torrentEngine.server.listen(8080)

            this.mediaPath="http://" + address() + ":8080/" + file.name
        },*/
        playFile:function(file){
            device.play(file)
        },
        deselectDevice:function(device){
            //if no device is passed in we try for the current device
            device=device||this.currentDevice
            //close connection to the device
            device.close()

            this.currentDeviceName = localStorage.currentDeviceName = ""
        }
    },
    beforeMount:function(){
        var self=this

        clientDiscovery.on('device',function(device){
            self.devices=clientDiscovery.devices
        })
    }
})