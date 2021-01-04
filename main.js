// Modules to control application life and create native browser window
const {app, BrowserWindow, Menu, protocol} = require('electron')
const path = require('path')
const url = require('url')
const fs = require('fs')
const mime = require('mime')

function createWindow () {
	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: 800,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js')
		}
	})

	// and load the index.html of the app.
	mainWindow.loadFile('index.html')

	// Open the DevTools.
	// mainWindow.webContents.openDevTools()

	return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
	Menu.setApplicationMenu(null)

	console.log(protocol)

	protocol.interceptBufferProtocol('file', protocolListener)
	
	var mainWindow=createWindow()

	mainWindow.webContents.on('before-input-event',(event,input) => {
		if(input.control && input.key.toLowerCase() === 'r'){
			mainWindow.reload()
			event.preventDefault()
		}

		if(input.control && input.shift && input.key.toLowerCase() === 'i'){
			mainWindow.webContents.openDevTools()
			event.preventDefault()
		}
	})
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
	if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
function protocolListener(request, callback) {
	try {
		var pathname=url.parse(request.url).pathname.substr(1)
		let fileContents = fs.readFileSync(pathname)
		let extension = path.extname(pathname)
		let mimeType = mime.getType(extension)

		if (extension === '.html') {
			fileContents = fileContents
			mimeType = 'text/html'
		}

		return callback({
			data: fileContents,
			mimeType: mimeType
		})

	} catch(exception) {
		console.error(exception)
		return callback(-6) // NET_ERROR(FILE_NOT_FOUND, -6)
	}
}