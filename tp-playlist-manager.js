const _ = require('lodash')

function PlaylistManager(playlists){
    if(!playlists) playlists=JSON.parse(localStorage.playlists||"[]")

    this.playlists=[]

    console.log(playlists)
    
    for(p of playlists){
        console.log("p",p,p.media)

        this.addPlaylist(p)

        for(m of p.media){
            this.addMedia(m)
        }
    }
    
    if(this.playlists.length==0) this.addPlaylist({name:"DEFAULT",isSelected:true})
}

PlaylistManager.prototype.addPlaylist = function (playlist){
    var newPlaylist=new Playlist(playlist)

    this.playlists.push(newPlaylist)

    this.storePlaylists()

    return newPlaylist
}

PlaylistManager.prototype.removePlaylist = function (playlistIndex){
    this.playlists.splice(playlistIndex,1)

    this.storePlaylists()
}

PlaylistManager.prototype.selectPlaylist = function (playlist){
    this.playlists.forEach(function(p){
        p.isSelected=false
    })

    playlist.isSelected=true

    this.storePlaylists()

    return playlist
}

PlaylistManager.prototype.getSelectedPlaylist = function (){
    return _.find(this.playlists,{isSelected:true})
}

/*PlaylistManager.prototype.getPlaylist = function (playlistIndex){ 
    if(this.playlists.length<=playlistIndex||playlistIndex<0) return false
    
    return this.playlists[playlistIndex]
}

PlaylistManager.prototype.getSelectedMedia = function (){
    var playlist=this.getSelectedPlaylist()
    
    return _.find(playlist.media,{isSelected:true})
}*/

PlaylistManager.prototype.getMedia = function (mediaIndex,playlist){
    var playlist=playlist||this.getSelectedPlaylist()
    
    if(!playlist||playlist.media.length<=mediaIndex||mediaIndex<0) return false

    return playlist.media[mediaIndex]
}

PlaylistManager.prototype.addMedia = function (media,playlist){
    var playlist=playlist||this.getSelectedPlaylist()
    
    if(typeof(media.currentTime)!="number") media.currentTime=0
    if(typeof(media.duration)!="number") media.duration=0
    if(typeof(media.subtitles)!="object") media.subtitles=[]
    if(typeof(media.isComplete)!="boolean") media.isComplete=false
    if(typeof(media.isSelected)!="boolean") media.isSelected=false
    if(typeof(media.isPlaying)!="boolean") media.isPlaying=false

    playlist.media.push(media)

    media.getPlaylist=function(){
        return playlist
    }

    console.log("adding media: ",media)

    this.storePlaylists()

    return media
}

PlaylistManager.prototype.removeMedia = function (mediaIndex,playlist){
    var playlist=playlist||this.getSelectedPlaylist()

    playlist.media.splice(mediaIndex,1)

    this.storePlaylists()
}

PlaylistManager.prototype.selectMedia = function (media){
    var playlist=media.getPlaylist()

    playlist.media.forEach(function(m){
        m.isSelected=false
    })

    media.isSelected=true

    this.storePlaylists()

    return media
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

PlaylistManager.prototype.storePlaylists = function (){
    localStorage.playlists=JSON.stringify(this.playlists)
}

function Playlist(playlist){
    this.name=playlist.name||"DEFAULT"
    //this.media=playlist.media||[]
    this.isSelected=playlist.isSelected||false
    this.media=[]
}

module.exports = PlaylistManager