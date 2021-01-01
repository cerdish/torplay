// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.

window.addEventListener('DOMContentLoaded', () => {
	//here we include the app.js so that it still has access to node process
	require("./app.js")
})