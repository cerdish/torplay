const _ = require('lodash')

function PlaylistManager(playlists){
    if(!playlists) playlists=JSON.parse(localStorage.playlists||"[]")

    this.playlists=[]

    console.log("loading playlists: ",playlists)
    
    try{
        for(p of playlists){
            this.addPlaylist(p)
        }
    }catch(e){
        this.storePlaylists(playlists)
    }
    
    
    if(this.playlists.length==0) this.addPlaylist({name:"DEFAULT",isSelected:true})
}

PlaylistManager.prototype.addPlaylist = function (playlist){
    var self=this
    var newPlaylist=new Playlist(playlist)

    newPlaylist.getParent=function(){
        return self
    }

    if(playlist.media instanceof Array){
        for(m of playlist.media){
            this.addMedia(m,newPlaylist)
        }
    }

    this.playlists.push(newPlaylist)

    this.storePlaylists()

    return newPlaylist
}

PlaylistManager.prototype.removePlaylist = function (playlistIndex){
    this.playlists.splice(playlistIndex,1)

    this.storePlaylists()
}

PlaylistManager.prototype.selectPlaylist = function (playlist){
    return this.selectItem(playlist,"playlists")
}

PlaylistManager.prototype.getSelectedPlaylist = function (){
    return _.find(this.playlists,{isSelected:true})
}

PlaylistManager.prototype.getSelectedMedia = function (){
    var playlist=this.getSelectedPlaylist()
    
    return _.find(playlist.media,{isSelected:true})
}

PlaylistManager.prototype.getMedia = function (mediaIndex,playlist){
    var playlist=playlist||this.getSelectedPlaylist()
    
    if(!playlist||playlist.media.length<=mediaIndex||mediaIndex<0) return false

    return playlist.media[mediaIndex]
}

PlaylistManager.prototype.addMedia = function (media,playlist){
    var playlist=playlist||this.getSelectedPlaylist()
    
    var newMedia=new Media(media,playlist)
    
    if(media.subtitles instanceof Array&&media.subtitles.length){
        for(s of media.subtitles){
            this.addSubtitles(s,newMedia)
        }
    }
    
    console.log("adding media: ",newMedia)

    playlist.media.push(newMedia)

    this.storePlaylists()

    return newMedia
}

PlaylistManager.prototype.removeMedia = function (mediaIndex,playlist){
    var playlist=playlist||this.getSelectedPlaylist()

    playlist.media.splice(mediaIndex,1)

    this.storePlaylists()
}

PlaylistManager.prototype.selectMedia = function (media){
    return this.selectItem(media,"media")
}

PlaylistManager.prototype.playMedia = function (media){
    this.playlists.forEach(function(p){
        p.media.forEach(function(m){
            m.isPlaying=false
        })
    })

    media.isPlaying=true

    this.storePlaylists()

    return media
}

PlaylistManager.prototype.addSubtitles = function (subtitles,media){
    var media=media||this.getSelectedMedia()

    var newSubtitles=new Subtitles(subtitles,media)
    
    media.subtitles.push(newSubtitles)

    console.log("adding subtitles: ",newSubtitles)

    this.storePlaylists()

    return newSubtitles
}

PlaylistManager.prototype.removeSubtitles = function (subtitles){
    var media=subtitles.getParent()

    sIndex=_.findIndex(media.subtitles,{filename:subtitles.filename})

    media.splice(sIndex,1)

    this.storePlaylists()
}

PlaylistManager.prototype.selectSubtitles = function(subtitles){
    return this.selectItem(subtitles,"subtitles")
}

PlaylistManager.prototype.selectItem = function (item){
    var parent=item.getParent()

    console.log("selecting "+item.itemKey+" :",item)

    this.deselectAll(parent[item.itemKey])

    item.isSelected=true

    this.storePlaylists()

    return item
}

PlaylistManager.prototype.deselectAll = function (array){
    array.forEach(function(o){
        o.isSelected=false
    })
}

PlaylistManager.prototype.storePlaylists = function (playlists){
    playlists=playlists||this.playlists

    localStorage.playlists=JSON.stringify(playlists)
}

function computeDisplayName(filename){
    var displayName=filename
    if(filename.indexOf("/")>-1) displayName=filename.substr(filename.lastIndexOf("/")+1)
    if(filename.indexOf("\\")>-1)displayName=displayName.substr(filename.lastIndexOf("\\")+1)

    return displayName
}

class Item{
    constructor(itemKey,obj,parent){
        this.isSelected=false,
        this.itemKey=itemKey

        if(typeof(obj)=="object"){
            this.isSelected=obj.isSelected||false
        }

        this.getParent=function(){
            return parent
        }
    }
}

class Playlist extends Item{
    constructor(playlist,parent){
        super("playlists",playlist,parent)

        this.name=playlist.name||"DEFAULT"
        this.media=[]
        this.isSelected=playlist.isSelected||false
    }
}

class Media extends Item{
    constructor(media,parent){
        super("media",media,parent)

        this.filename=media.filename||"DEFAULT"
        this.torrentUrl=media.torrentUrl||false
        this.fileUrl=media.fileUrl||false
        this.filePath=media.filePath||false

        this.currentTime=media.currentTime||0
        this.duration=media.duration||0
        this.isComplete=media.isComplete||false
        this.isPlaying=media.isPlaying||false
        this.displayName=media.displayName||computeDisplayName(media.filename)
        this.subtitles=[]
    }
}

class Subtitles extends Item{
    constructor(subtitles,parent){
        super("subtitles",subtitles,parent)

        this.filename=subtitles.filename||"DEFAULT"
        this.torrentUrl=subtitles.torrentUrl||false
        this.fileUrl=subtitles.fileUrl||false
        this.filePath=subtitles.filePath||false
        this.displayName=subtitles.displayName||computeDisplayName(subtitles.filename)
    }
}

module.exports = PlaylistManager