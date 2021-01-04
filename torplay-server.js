const http = require('http')
const url = require('url')
const address = require('network-address')
const _ = require('lodash')
const mime = require('mime')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const srt2vtt = require('srt-to-vtt')
const parseRange = require('range-parser')

const SUPPORTED_MEDIA_FORMATS=["mp4","m4v","webm","mkv"]

function torplayServer(){
    var self=this

    self.isServerRunning=false
    self.port=8080
    self.torrentEngine=false

    self.server=http.createServer(function(req,res){
        const urlInfo = url.parse(req.url,true)
        const pathname = urlInfo.pathname

        const filename=decodeURI(pathname.substr(pathname.lastIndexOf("/")+1,req.url.length))
        const type=mime.getType(filename)
        const ext=mime.getExtension(type)

        console.log("starting request: "+filename)

        const torrentUrl=urlInfo.query.torrentUrl || false

        if(torrentUrl){
            var torrentEngine=self.torrentEngine

            if(torrentEngine&&torrentEngine.torrentUrl==torrentUrl){
                self.handleTorrentReq(req,res,filename,ext,type)
            }else{
                //if we have a torrent engine already running but the request doesn't match that torrent we start a new engine.
                if(torrentEngine){
                    torrentEngine.destroy(function(){
                        self.startEngine(torrentUrl,self.handleTorrentReq.bind(self),[req,res,filename,ext,type])
                    })
                }else{
                    self.startEngine(torrentUrl,self.handleTorrentReq.bind(self),[req,res,filename,ext,type])
                }
            }
        }else{
            self.handleNotFoundReq(req,res,filename)
        }
    })
    
    self.server.on('connection', function (socket) {
        socket.setTimeout(36000000)
    })
}

torplayServer.prototype.startEngine = function (torrentUrl,callback,callbackArgs){
    var self=this

    readTorrent(torrentUrl,function(e,torrent){
        if(e) console.log(e)

        self.torrentEngine=torrentStream(torrent)
        //store the torrent url here so we can match it later to see if we are running the corrent torrent engine
        self.torrentEngine.torrentUrl=torrentUrl

        self.torrentEngine.on('ready',function(){
            if(callback) callback(...callbackArgs)
        })
    })
}

torplayServer.prototype.listen = function (port,callback) {
    var self=this

    if(port) self.port=port

    self.server.listen(self.port,function(){
        console.log("torplay server is listening")
        
        self.isServerRunning=true

        if(callback) callback()
    })
}

torplayServer.prototype.handleTorrentReq = function (req,res,filename,ext,type){
    var self=this

    if(SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
        var mediaFile=_.find(self.torrentEngine.files,{name:filename})
        var mediaStream=false

        //if we don't find the file then we return not found and return
        if(!mediaFile){
            self.handleNotFoundReq(req,res,filename)
            return false
        }

        console.log("piping media")
        
        res.setHeader("Content-Type",type)
        
        //set the response headers for byte ranges, this is required for seeking
        res.setHeader("Accept-Ranges","bytes")
        
        //calculate the range of bytes to return
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
    }else if(ext=='srt'){
        var srtFile=_.find(torrentEngine.files,{name:filename})

        if(!srtFile){
            this.handleNotFoundReq(req,res,filename)
            return false
        }

        console.log("piping srt")
        
        res.setHeader("Access-Control-Allow-Origin","*")
        res.setHeader("Content-Type","text/vtt")
        
        var srtStream=srtFile.createReadStream()
        
        srtStream.pipe(srt2vtt()).pipe(res)
    }
}

torplayServer.prototype.handleNotFoundReq = function (req,res,filename){
    console.log("not found: "+filename)
    res.end()
}

torplayServer.prototype.close = function (callback) {
    var self=this

    self.server.close(self.port,function(){
        console.log("torplay server is closed")
        
        self.isServerRunning=false

        if(callback) callback()
    })
}

torplayServer.prototype.getMediaDeliveryPath = function (filename,torrentUrl){
    var mediaDeliveryPath="http://" + address() + ":8080/" + filename

    if(torrentUrl) mediaDeliveryPath+="?torrentUrl=" + encodeURI(torrentUrl)

    return mediaDeliveryPath 
}

module.exports = torplayServer