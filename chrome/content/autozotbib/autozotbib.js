Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");

var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.autozotbib.");
var prefs_window_ref;

var data;

var events_id = [];
var events_type = [];
var events_timestamp = [];

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

  	/*
	Searches for items in the Zotero database
	with the given author and year, and returns those items.
  	*/
  	search_for_items: function(author, year) {
  		dump("ALERT!\n");
  		var s = new Zotero.Search();
  		s.addCondition('creator', 'contains', author);
  		s.addCondition('year', 'contains', year);

  		var results = s.search();

  		dump(results);
  		var items = Zotero.Items.get(results);
  		dump("Got items\n");

  		return(items);
  	},

  	/*
  	Appends the given list of items (that is, full items, not item IDs) to
  	the output file (as configured in the preferences)
  	*/
	appendItemsToFile: function(items) {
		var translation = new Zotero.Translate.Export();
		translation.setItems(items);
		trans_guid = prefs.getCharPref("bibtex_translator_guid");
		translation.setTranslator(trans_guid);
		translation.setHandler("done", this._appendToFileCallback);
		translation.translate();
	},

	/*
	The callback function for use with appendItemsToFile
	which actually does the writing
	*/
	_appendToFileCallback: function(obj, worked) {
		if(!worked) {
			window.alert("Error exporting items to BibTeX.");
		} else {
			var data = obj.string;

			var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
			var filename = prefs.getCharPref("bibtex_filename");
			file.initWithPath(filename);

			// You can also optionally pass a flags parameter here. It defaults to
			// FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE;
			var ostream = FileUtils.openFileOutputStream(file, FileUtils.MODE_WRONLY | FileUtils.MODE_APPEND);
			 
			var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
			                createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
			converter.charset = "UTF-8";
			var istream = converter.convertToInputStream(data);
			 
			// The last argument (the callback) is optional.
			NetUtil.asyncCopy(istream, ostream, function(status) {
			  if (!Components.isSuccessCode(status)) {
			    // Handle error!
			    return;
			  }
			 
			  // Data has been written to the file.
			  dump("Written to file!");
			});
		}
	},

	/*
	Removes ALL entries with the given first author
	and year from the Bibtex file specified in the preferences
	*/
  	removeBibtexEntry: function(author, year) {
		var file = Components.classes["@mozilla.org/file/local;1"].
	           createInstance(Components.interfaces.nsILocalFile);

	    var filename = prefs.getCharPref("bibtex_filename");
		file.initWithPath(filename);

		NetUtil.asyncFetch(file, function(inputStream, status) {
		  if (!Components.isSuccessCode(status)) {
		    // Handle error!
		    dump("Error in reading file!\n");
		    return;
		  }
		  // Read file into a string variable called data
		  data = NetUtil.readInputStreamToString(inputStream, inputStream.available());


		  // Add a new fake entry starting with @ at the end so that the regexp
		  // works for the final entry in the file
		  data = data + "\n\n@REPLACETHIS"

		  // Remove the BibTeX entry given as arguments to this function
		  // by using a regexp
		  data = data.replace(new RegExp('@[^@]+?author = \{(' + author + '),[^@]+?year = \{(' + year + ')\},[^@]+?(?=@)','g'), "")

		  // Remove the @REPLACETHIS bit as it is invalid BibTex!
		  data = data.replace('@REPLACETHIS', '')

		  // You can also optionally pass a flags parameter here. It defaults to
		  // FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE;
		  var ostream = FileUtils.openSafeFileOutputStream(file);
		 
		  var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
		                createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
		  converter.charset = "UTF-8";
		  var istream = converter.convertToInputStream(data);
		 
		  // The last argument (the callback) is optional.
		  NetUtil.asyncCopy(istream, ostream, function(status) {
		    if (!Components.isSuccessCode(status)) {
		      // Handle error!
		      dump("Error writing file.\n")
		      return;
		    }
		 
		  // Data has been written to the file.
		  dump("All data written!!!!!\n");
		});
		});
	},

	exportItems: function(items, filename) {
		dump("In exportItems\n");
		dump(items);

		var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
		file.initWithPath(filename);
		
		var translator = new Zotero.Translate('export');
		trans_guid = prefs.getCharPref("bibtex_translator_guid");
		//translator.setTranslator('DA47106C-1265-4D19-8E75-0A4CD77CD369'); // BibTeX
		translator.setTranslator(trans_guid);
		translator.setItems(items);
		translator.setLocation(file);
		translator.translate();
	},

	exportAll: function() {
		var all_items = Zotero.Items.getAll(true)
		var filename = prefs.getCharPref("bibtex_filename");

		this.exportItems(all_items, filename);
  	},
	
	processItems: function(ids) {
		// Processes items that have changed (add/modify/delete)

		// Get authors and years from the ids

		// Search Zotero library for items with those authors and years
		// (each call to searchItems does it for one author/year combo,
		// run many times and join results - then remove any duplicates)

		// Remove all entries with these authors and years from the BibTeX file
		// We can call removeBibtexEntries with a list of authors and list of years
		// and it will do it for all of them (more efficient than reading/writing file
		// many times).

		// Export all of the entries that we found in the search and
		// append to the file
	},

	// Callback implementing the notify() method to pass to the Notifier
	notifierCallback: {
	    notify: function(event, type, ids, extraData) {
		//if (prefs.getBoolPref("automatic")) {
		//	Zotero.AutoZotBib.exportAll()
		//}

		for (i in ids)
		{
			var item = Zotero.Items.get(ids[i]);
			if (!item.isRegularItem())
			{
				ids.splice(i, 1);
			}
		}
		secs = new Date().getTime() / 1000;

		// Only continue if we have some items left
		// (ie. all of the items weren't attachments etc and therefore)
		// deleted in the loop above
		// AND
		// we are dealing with a item (we don't care about collections, tags etc)
		if (ids.length > 0 && type == 'item')
		{
			events_timestamp.push(secs);
			events_type.push(event);
			events_id.push(ids);

			// dump(secs);
			// dump(":\t");	
			// dump(event);
			// dump("\t");
			// dump(type);
			// dump("\t");
			// dump(ids);
			// dump("\t");
			// dump(extraData);
			// dump("\n------------\n\n");

			dump(events_timestamp.join());
			dump("\n");
			dump(events_type.join());
			dump("\n");
			dump(events_id.join());
			dump("\n");
			dump("\n");
		}
		



		
	    }
	}
};

// Initialize the utility
window.addEventListener('load', function(e) { Zotero.AutoZotBib.init(); }, false);
