// Only create main object once
if (!Zotero.AutoZotBib) {
	var loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
					.getService(Components.interfaces.mozIJSSubScriptLoader);
	loader.loadSubScript("chrome://autozotbib/content/autozotbib.js");
}
