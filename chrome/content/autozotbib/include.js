// Only create main object once
if (!Zotero.AutoZotBib) {
	const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
					.getService(Components.interfaces.mozIJSSubScriptLoader);
	loader.loadSubScript("chrome://autozotbib/content/autozotbib.js");
}
