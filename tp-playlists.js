function Playlists(playlistData){
    if(!playlistData) playlistData=JSON.parse(localStorage.playlistData||"{}")
    
    this.list=playlistData.list||[]
    
    if(this.list.length==0) this.add("DEFAULT")

    this.selectPlaylist(playlistData.selectedPlaylist||0)
}

Playlists.prototype.add = function (name){
    var playlist=new Playlist(name)

    this.list.push(playlist)

    return playlist
}

Playlists.prototype.addMedia = function (playlistIndex,media){
    if(typeof(playlistIndex)!="number") playlistIndex=this.selectedPlaylist

    if(typeof(media.currentTime)!="number") media.currentTime=0
    if(typeof(media.duration)!="number") media.duration=0
    if(typeof(media.selectedCaptions)!="number") media.selectedCaptions=-1
    if(typeof(media.isComplete)!="boolean") media.isComplete=false
    
    this.list[playlistIndex].media.push(media)

    this.storePlaylist()
}

Playlists.prototype.removeMedia = function (playlistIndex,mediaIndex){
    if(typeof(playlistIndex)!="number") playlistIndex=this.selectedPlaylist

    this.list[playlistIndex].media.splice(mediaIndex,1)
}

Playlists.prototype.selectPlaylist = function (playlistIndex){
    this.selectedPlaylist=playlistIndex

    this.storePlaylist()
}

Playlists.prototype.selectMedia = function (mediaIndex){
    this.list[this.selectedPlaylist].selectedMedia=mediaIndex

    this.storePlaylist()
}

Playlists.prototype.storePlaylist = function (){
    localStorage.playlistData=JSON.stringify(this)
}

function Playlist(name){
    this.name=name
    this.media=[]
    this.selectedMedia=-1
}

module.exports = Playlists