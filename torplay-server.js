const http = require('http')
const url = require('url')
const address = require('network-address')
const _ = require('lodash')
const mime = require('mime')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const srt2vtt = require('srt-to-vtt')
const parseRange = require('range-parser')
const axios = require('axios')
const fs = require('fs')

axios.defaults.adapter = require('axios/lib/adapters/http')

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
        
        console.log("starting request: "+filename+" range: "+req.headers.range)

        const torrentUrl=urlInfo.query.torrentUrl ? atob(urlInfo.query.torrentUrl) : false
        const httpUrl=urlInfo.query.httpUrl ? atob(urlInfo.query.httpUrl) : false
        const filePath=urlInfo.query.filePath ? atob(urlInfo.query.filePath) : false

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
        }else if(httpUrl){
            self.handleHttpReq(httpUrl,req,res,filename,ext,type)
        }else if(filePath){
            self.handleFileReq(filePath,req,res,filename,ext,type)
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
    if(SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
        var mediaFile=_.find(this.torrentEngine.files,{name:filename})
        var mediaStream=false

        //if we don't find the file then we return not found and return
        if(!mediaFile){
            this.handleNotFoundReq(req,res,filename)
            return false
        }

        //calculate the range of bytes to return based on headers
        var range=req.headers.range ? parseRange(mediaFile.length,req.headers.range)[0] : false

        mediaStream=mediaFile.createReadStream(range ? range : null)

        this.deliverMedia(mediaStream,req,res,filename,ext,type,mediaFile.length,range)
    }else if(ext=='srt'||ext=='vtt'){
        var srtFile=_.find(this.torrentEngine.files,{name:filename})

        if(!srtFile){
            this.handleNotFoundReq(req,res,filename)
            return false
        }

        var srtStream=srtFile.createReadStream()

        this.deliverSubtitles(srtStream,req,res,filename,ext,type)
    }
}

torplayServer.prototype.handleHttpReq = function (httpUrl,req,res,filename,ext,type){
    var self=this
    
    axios({
        method:"get",
        url:httpUrl,
        responseType:'stream'
    }).then(function(axiosRes){
        console.log(axiosRes)

        if(SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
            self.deliverMedia(axiosRes.data,req,res,filename,ext,type,axiosRes.headers["content-length"],false)
        }else if(ext=='srt'||ext=='vtt'){
            self.deliverSubtitles(axiosRes.data,req,res,filename,ext,type)
        }else{
            self.handleNotFoundReq(req,res,filename)
        }
    }).catch(function(e){
        console.log(e)
        self.handleNotFoundReq(req,res,filename)
    })
}

torplayServer.prototype.handleFileReq = function (filePath,req,res,filename,ext,type){
    //calculate the range of bytes to return based on headers
    var fileSize=fs.statSync(filePath).size

    var range=req.headers.range ? parseRange(fileSize,req.headers.range)[0] : false

    var fileStream=fs.createReadStream(filePath,range ? range : null)


    if(SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
        this.deliverMedia(fileStream,req,res,filename,ext,type,fileSize,range)
    }else if(ext=='srt'||ext=='vtt'){
        this.deliverSubtitles(fileStream,req,res,filename,ext,type)
    }else{
        this.handleNotFoundReq(req,res,filename)
    }
}

torplayServer.prototype.deliverMedia = function (stream,req,res,filename,ext,type,fileSize,range){
    console.log("piping media")
    
    res.setHeader("Content-Type",type)
    
    //set the response headers for byte ranges, this is required for seeking
    res.setHeader("Accept-Ranges","bytes")
    
    var contentLength=fileSize

    if(range){
        contentLength=range.end-range.start+1
        res.setHeader('Content-Range','bytes '+range.start+'-'+range.end+'/'+fileSize)
        res.statusCode=206
    }
    
    res.setHeader('Content-Length',contentLength)
    
    stream.pipe(res)
}

torplayServer.prototype.deliverSubtitles = function (stream,req,res,filename,ext,type){
    console.log("piping srt")
        
    res.setHeader("Access-Control-Allow-Origin","*")
    res.setHeader("Content-Type","text/vtt")

    if(ext=="srt"){
        stream.pipe(srt2vtt()).pipe(res)
    }else{
        stream.pipe(res)
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

torplayServer.prototype.getMediaDeliveryPath = function (file){
    var mediaDeliveryPath="http://" + address() + ":8080/" + file.filename
    
    var type=mime.getType(file.filename)
    var ext=mime.getExtension(type)

    if(file.torrentUrl) mediaDeliveryPath+="?torrentUrl=" + encodeURI(btoa(file.torrentUrl))

    if(file.httpUrl){
        if(ext=="srt") mediaDeliveryPath+="?httpUrl=" + encodeURI(btoa(file.httpUrl))
        else mediaDeliveryPath=file.httpUrl
    }

    if(file.filePath) mediaDeliveryPath+="?filePath=" + encodeURI(btoa(file.filePath))

    console.log(mediaDeliveryPath)
    
    return mediaDeliveryPath 
}

module.exports = torplayServer