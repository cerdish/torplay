function Playlists(playlistData){
    if(!playlistData) playlistData=JSON.parse(localStorage.playlistData||"{}")
    
    this.list=playlistData.list||[]
    
    if(this.list.length==0) this.addPlaylist("DEFAULT")

    this.selectPlaylist(playlistData.selectedPlaylistIndex||0)
}

Playlists.prototype.addPlaylist = function (name){
    var playlist=new Playlist(name)

    this.list.push(playlist)

    this.storePlaylists()

    return playlist
}

Playlists.prototype.getSelectedPlaylist = function (){    
    return this.getPlaylist(this.selectedPlaylistIndex)
}

Playlists.prototype.getPlaylist = function (playlistIndex){ 
    if(this.list.length<=playlistIndex) return false
    
    return this.list[playlistIndex]
}

Playlists.prototype.getSelectedMedia = function (){
    var playlist=this.getSelectedPlaylist()
    
    return this.getMedia(this.selectedPlaylistIndex,playlist.selectedMediaIndex)
}

Playlists.prototype.getMedia = function (playlistIndex,mediaIndex){
    var playlist=this.getPlaylist(playlistIndex)

    if(!playlist||playlist.media.length<=mediaIndex) return false

    return playlist.media[mediaIndex]
}

Playlists.prototype.addMedia = function (media,playlistIndex){
    if(typeof(playlistIndex)!="number") playlistIndex=this.selectedPlaylistIndex

    if(typeof(media.currentTime)!="number") media.currentTime=0
    if(typeof(media.duration)!="number") media.duration=0
    if(typeof(media.selectedCaptions)!="number") media.selectedCaptions=-1
    if(typeof(media.isComplete)!="boolean") media.isComplete=false
    if(typeof(media.subtitles)!="array") media.subtitles=[]
    
    this.list[playlistIndex].media.push(media)

    console.log("adding media: ",this.list)

    this.storePlaylists()

    return media
}

Playlists.prototype.removeMedia = function (mediaIndex,playlistIndex){
    if(typeof(playlistIndex)!="number") playlistIndex=this.selectedPlaylistIndex

    var playlist=this.list[playlistIndex]

    //if we are removing the currently selected media we unselect all media
    if(playlist.selectedMediaIndex==mediaIndex) playlist.selectedMediaIndex=-1
    //if the media we removing as above the currently selected media we have to move the selected media index up by 1
    else if(playlist.selectedMediaIndex>mediaIndex) playlist.selectedMediaIndex--

    playlist.media.splice(mediaIndex,1)

    this.storePlaylists()
}

Playlists.prototype.selectPlaylist = function (playlistIndex){
    this.selectedPlaylistIndex=playlistIndex

    this.storePlaylists()
}

Playlists.prototype.selectMedia = function (mediaIndex){
    this.list[this.selectedPlaylistIndex].selectedMediaIndex=mediaIndex

    this.storePlaylists()
}

Playlists.prototype.storePlaylists = function (){
    localStorage.playlistData=JSON.stringify(this)
}

function Playlist(name){
    this.name=name
    this.media=[]
    this.selectedMediaIndex=-1
}

module.exports = Playlists