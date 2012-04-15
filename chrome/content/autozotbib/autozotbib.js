var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.autozotbib.");
var prefs_window_ref;

Zotero.AutoZotBib = {	
	init: function () {		
		// Register the callback in Zotero as an item observer
		var notifierID = Zotero.Notifier.registerObserver(this.notifierCallback, ['item']);
		
		// Unregister callback when the window closes (important to avoid a memory leak)
		window.addEventListener('unload', function(e) {
				Zotero.Notifier.unregisterObserver(notifierID);
		}, false);
	},

	
	preferences: function(w) {
    	if (! prefs_window_ref || prefs_window_ref.closed) prefs_window_ref = w.open("chrome://autozotbib/content/preferences.xul", "", "centerscreen,chrome,dialog,resizable");
    	else prefs_window_ref.focus();
  	},
	
	exportAll: function() {
		var all_items = Zotero.Items.getAll(true)
		
		var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
		var filename = prefs.getCharPref("bibtex_filename");
		file.initWithPath(filename);
		
		var translator = new Zotero.Translate('export');
		trans_guid = prefs.getCharPref("bibtex_translator_guid");
		//translator.setTranslator('DA47106C-1265-4D19-8E75-0A4CD77CD369'); // BibTeX
		translator.setTranslator(trans_guid);
		translator.setItems(all_items);
		translator.setLocation(file);
		translator.translate();
  	},
	
	// Callback implementing the notify() method to pass to the Notifier
	notifierCallback: {
	    notify: function(event, type, ids, extraData) {
		if (prefs.getBoolPref("automatic")) {
			Zotero.AutoZotBib.exportAll()
		}
	    }
	}
};

// Initialize the utility
window.addEventListener('load', function(e) { Zotero.AutoZotBib.init(); }, false);
