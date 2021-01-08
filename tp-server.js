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

function torplayServer(){
    var self=this

    self.SUPPORTED_MEDIA_FORMATS=["mp4","m4v","webm","mkv"]
    self.SUPPORTED_CAPTION_FORMATS=["srt","vtt"]
    self.SUPPORTED_IMAGE_FORMATS=["jpg","gif","png","jpeg"]
    self.SUPPORTED_FILE_FORMATS=self.SUPPORTED_IMAGE_FORMATS

    self.isServerRunning=false
    self.port=8080
    self.torrentEngine=false

    self.server=http.createServer(function(req,res){
        const urlInfo = url.parse(req.url,true)
        const pathname = urlInfo.pathname

        const filename=decodeURI(pathname)
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
        
        //give the server a litteral second to spin up before we start sending reqeusts to it
        setTimeout(function(){
            self.isServerRunning=true
        },1000)

        if(callback) callback()
    })
}

torplayServer.prototype.handleTorrentReq = function (req,res,filename,ext,type){
    var torrentFile=_.find(this.torrentEngine.files,function(f){
        var fpath=decodeURI(url.parse(f.path).pathname)

        console.log(fpath,filename)
        
        return "/"+fpath==filename
    })

    //if we don't find the file then we return not found and return
    if(!torrentFile){
        this.handleNotFoundReq(req,res,filename)
        return false
    }

    if(this.SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
        //calculate the range of bytes to return based on headers
        var range=req.headers.range ? parseRange(torrentFile.length,req.headers.range)[0] : false

        var stream=torrentFile.createReadStream(range ? range : null)

        this.deliverMedia(stream,req,res,filename,ext,type,torrentFile.length,range)
    }else if(this.SUPPORTED_CAPTION_FORMATS.indexOf(ext)>-1){
        var stream=torrentFile.createReadStream()

        this.deliverSubtitles(stream,req,res,filename,ext,type)
    }else if(this.SUPPORTED_FILE_FORMATS.indexOf(ext)>-1){
        var stream=torrentFile.createReadStream()

        this.deliverFile(stream,req,res,filename,ext,type)
    }else{
        this.handleNotFoundReq(req,res,filename)
    }
}

torplayServer.prototype.handleHttpReq = function (httpUrl,req,res,filename,ext,type){
    var self=this
    
    axios({
        method:"get",
        url:httpUrl,
        responseType:'stream'
    }).then(function(axiosRes){
        if(self.SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
            self.deliverMedia(axiosRes.data,req,res,filename,ext,type,axiosRes.headers["content-length"],false)
        }else if(self.SUPPORTED_CAPTION_FORMATS.indexOf(ext)>-1){
            self.deliverSubtitles(axiosRes.data,req,res,filename,ext,type)
        }else if(self.SUPPORTED_FILE_FORMATS.indexOf(ext)>-1){
            self.deliverFile(axiosRes.data,req,res,filename,ext,type)
        }else{
            self.handleNotFoundReq(req,res,filename)
        }
    }).catch(function(e){
        console.log(e)
        self.handleNotFoundReq(req,res,filename)
    })
}

torplayServer.prototype.handleFileReq = function (filePath,req,res,filename,ext,type){
    var self=this

    //calculate the range of bytes to return based on headers
    var fileSize=fs.statSync(filePath).size

    var range=req.headers.range ? parseRange(fileSize,req.headers.range)[0] : false

    var fileStream=fs.createReadStream(filePath,range ? range : null)

    fileStream.on("error",function(e){
        console.log(e)
    })

    fileStream.on('open',function(){        
        if(self.SUPPORTED_MEDIA_FORMATS.indexOf(ext)>-1){
            self.deliverMedia(fileStream,req,res,filename,ext,type,fileSize,range)
        }else if(self.SUPPORTED_CAPTION_FORMATS.indexOf(ext)>-1){
            self.deliverSubtitles(fileStream,req,res,filename,ext,type)
        }else if(self.SUPPORTED_FILE_FORMATS.indexOf(ext)>-1){
            self.deliverFile(axiosRes.data,req,res,filename,ext,type)
        }else{
            self.handleNotFoundReq(req,res,filename)
        }
    })
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

torplayServer.prototype.deliverFile = function (stream,req,res,filename,ext,type){
    console.log("piping file")
        
    res.setHeader("Access-Control-Allow-Origin","*")
    res.setHeader("Content-Type",type)

    stream.pipe(res)
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

torplayServer.prototype.getDeliveryPath = function (file){
    var mediaDeliveryPath="http://" + address() + ":8080/" + url.parse(file.filename).pathname
    
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