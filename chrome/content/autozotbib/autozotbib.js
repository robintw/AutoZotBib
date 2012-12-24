Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");

var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.autozotbib.");
var prefs_window_ref;

var data;

var events_id = [];
var events_type = [];
var events_timestamp = [];

var okToWriteToBibtex = true;
var needToAppendStill = false;

var lastTimestamp;
var timerRunning = false;


const TYPE_REPEATING_PRECISE_CAN_SKIP = Components.interfaces.nsITimer.TYPE_REPEATING_PRECISE_CAN_SKIP;

const DIFF_DO_NOTHING = 1;
const DIFF_CLEAR_QUEUE = 5;
const DIFF_STOP_TIMER = 20;

var prefsEvent = {
	observe: function(subject, topic, data) {
     if (topic != "nsPref:changed")
     {
       return;
     }

     //dump(subject + "\t" + topic + "\t" + data + "\n");
     switch (data)
     {
     	case "bibtex_filename":
	     	// The filename we should export to has changed
	     	// Thus we need to do a full export - so that we can then add/remove
	     	// things from it.
	     	// (but only if we're in automatic mode - otherwise we shouldn't touch it!)
	     	if (prefs.getBoolPref('automatic'))
	     	{
	     		Zotero.AutoZotBib.exportAll();
	     	}
	     	break;
	    case "automatic":
	    	// If we have just switched the automatic mode on
	    	// then do a full export - as we don't know what
	    	// happened while it was off!
	    	if (prefs.getBoolPref('automatic'))
	    	{
	    		Zotero.AutoZotBib.exportAll();
	    	}
     }
	}
}

// we need an nsITimerCallback compatible...
// ... interface for the callbacks.
var timerEvent = {
  queueEmpty: function() {
  	if (events_timestamp.length == 0)
  	{
  		return(true);
  	}
  	else
  	{
  		return(false);
  	}
  },

  observe: function(subject, topic, data) {
  	if (events_timestamp.length > 0)
  	{
  		lastTimestamp = events_timestamp[events_timestamp.length - 1];
  	}
    currentTimestamp = new Date().getTime() / 1000;

    diff = currentTimestamp - lastTimestamp;
    dump("Fired timer\tCurrent: " + currentTimestamp + "\tLast: " + lastTimestamp + "\tDiff: " + diff + "\n");
    if (diff < DIFF_DO_NOTHING)
    {
    	return;
    }
    if (diff > DIFF_CLEAR_QUEUE && diff < DIFF_STOP_TIMER && this.queueEmpty() == false)
    {
    	// Process queue, clear queue and process items
    	var ids = Zotero.AutoZotBib.processQueue();

    	dump("Clearing queue\n");
    	events_id.length = 0;
    	events_type.length = 0;
    	events_timestamp.length = 0;

    	dump("About to process items:\t");
    	dump(ids);
    	dump("\n");
    	dump("----------------------------------------------------------------\n");
    	Zotero.AutoZotBib.processItems(ids);
    }
    if (diff > DIFF_STOP_TIMER)
    {
    	// Stop timer
    	dump("Stopping timer\n");
    	Zotero.AutoZotBib.timer.cancel();
    	timerRunning = false;
    }
  }
}

var search_results = [];

Zotero.AutoZotBib = {
	timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

	init: function () {		
		// Register the callback in Zotero as an item observer
		var notifierID = Zotero.Notifier.registerObserver(this.notifierCallback, ['item']);

		// Unregister callback when the window closes (important to avoid a memory leak)
		window.addEventListener('unload', function(e) {
				Zotero.Notifier.unregisterObserver(notifierID);
		}, false);

		Zotero.addShutdownListener(this.onShutdown);


		prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
		prefs.addObserver("", prefsEvent, false);
	},

	onShutdown: function() {
		dump("\n######## We're about to shutdown - clear queue and process.\n\n");
		// If Zotero shuts down we need to clear the queue
		// and process it all - regardless of the timer
		var ids = Zotero.AutoZotBib.processQueue();
		events_id.length = 0;
    	events_type.length = 0;
    	events_timestamp.length = 0;
    	Zotero.AutoZotBib.processItems(ids);
	},
	
	preferences: function(w) {
    	if (! prefs_window_ref || prefs_window_ref.closed) prefs_window_ref = w.open("chrome://autozotbib/content/preferences.xul", "", "centerscreen,chrome,dialog,resizable");
    	else prefs_window_ref.focus();
  	},
	
	/* Process the queue of events
	and decide which item IDs should be processed
	*/
  	processQueue: function() {
  		// Very simple (but effective - I think) way of doing it
  		// at the moment just selects unique itemIDs from those in the
  		// queue.

  		// First ensure all itemIDs are numbers (some weren't for some reason)
  		events_id = events_id.map(function(x) {return Number(x);});

  		// Get the unique ones
  		unique_ids = this.uniqueElements(events_id);

  		return(unique_ids);
  	},

  	/*
	Searches for items in the Zotero database
	with the given author and year, and returns the ids of those items
  	*/
  	searchItems: function(author, year) {
  		var s = new Zotero.Search();
  		s.addCondition('creator', 'contains', author);
  		s.addCondition('year', 'contains', year);

  		var results = s.search();

  		return(results);
  	},

  	/*
  	Appends the items from the given list of item IDs
  	(IDs not full items) to
  	the output file (as configured in the preferences)
  	*/
	appendItemsToFile: function(ids) {
		dump("In append to file. Items = \t");
		dump(ids);
		dump("\n");

		items = Zotero.Items.get(ids);

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
			dump("Error exporting items to BibTeX.\n");
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
			  dump("Data has been appended to the file.");
			});
		}
	},

	/*
	Removes ALL entries with the given first author
	and year from the Bibtex file specified in the preferences
	*/
  	removeBibtexEntries: function(authors, years) {
  		okToWriteToBibtex = false;
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

		  // For every author and year given, remove those from the string
		  for (i in authors)
		  {
		  	// Remove the BibTeX entry given as arguments to this function
		  	// by using a regexp
		  	data = data.replace(new RegExp('@[^@]+?author = \{(' + authors[i] + '),[^@]+?year = \{(' + years[i] + ')\}[^@]+?(?=@)','g'), "")
		  }

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
		  dump("BibTeX entries have been removed.\n");

		  if (needToAppendStill)
		  {
		  	// Export all of the entries that we found in the search and
			// append to the file
			dump("\nAbout to append items to file.\n");
			Zotero.AutoZotBib.appendItemsToFile(search_results);
		  }
		  okToWriteToBibtex = true;
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

  	// Returns just the unique elements from the array
  	// Taken from http://net.tutsplus.com/tutorials/javascript-ajax/javascript-from-null-utility-functions-and-debugging/
  	uniqueElements: function(origArr) {
    var newArr = [],
        origLen = origArr.length,
        found,
        x, y;
    for ( x = 0; x < origLen; x++ ) {
        found = undefined;
        for ( y = 0; y < newArr.length; y++ ) {
            if ( origArr[x] === newArr[y] ) {
              found = true;
              break;
            }
        }
        if ( !found) newArr.push( origArr[x] );
    }
   return newArr;
   },
	
	processItems: function(ids) {
		// Processes items that have changed (add/modify/delete)
		dump("In processItems\n");
		var authors = [];
		var years = [];

		dump(ids);
		// Get authors and years from the ids
		for (i in ids)
		{
			// Get the item
			var item = Zotero.Items.get(ids[i]);
			// Get the author
			var creators = item.getCreators();
			authors.push(creators[0].ref.lastName);

			// Get the year
			var date_str = item.getField('date');
			var date_obj = Zotero.Date.strToDate(date_str);
			years.push(date_obj.year);
		}

		dump(authors);
		dump("\n");
		dump(years);

		// Remove all entries with these authors and years from the BibTeX file
		// We can call removeBibtexEntries with a list of authors and list of years
		// and it will do it for all of them (more efficient than reading/writing
		// file many times).
		dump("About to remove entries\n");
		this.removeBibtexEntries(authors, years);
		dump("Removed entries\n");

		// Search Zotero library for items with those authors and years
		// (each call to searchItems does it for one author/year combo,
		// run many times and join results - then remove any duplicates)
		
		
		for (i in authors)
		{
			var author = authors[i];
			var year = years[i];

			var results = this.searchItems(author, year);

			if (results == false)
			{
				continue;
			}

			search_results = search_results.concat(results);
		}

		search_results = this.uniqueElements(search_results);

		dump("All search results are:\n");
		dump(search_results);

		if (search_results.length == 0)
		{
			return;
		}

		if (okToWriteToBibtex)
		{
			// Export all of the entries that we found in the search and
			// append to the file
			dump("\nAbout to append items to file.\n");
			this.appendItemsToFile(search_results);
		}
		else
		{
			needToAppendStill = true;
		}

		
	},

	// Callback implementing the notify() method to pass to the Notifier
	notifierCallback: {
	    notify: function(event, type, ids, extraData) {

		if (prefs.getBoolPref("automatic") == false || prefs.getCharPref("bibtex_filename") == "")
		{
			return;
		}

		// Remove items that aren't regular items (eg. attachments etc)
		// from the list of ids given to us.
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

			if (ids.length > 1)
			{
				events_id.concat(ids);
			}
			else
			{
				events_id.push(ids);
			}

			dump(events_timestamp.join());
			dump("\n");
			dump(events_type.join());
			dump("\n");
			dump(events_id.join());
			dump("\n");
			dump("\n");
		}
		
		if (timerRunning == false)
		{
			Zotero.AutoZotBib.timer.init(timerEvent, 1000, TYPE_REPEATING_PRECISE_CAN_SKIP);
			timerRunning = true;
		}

	    }
	}
};

// Initialize the utility
window.addEventListener('load', function(e) { Zotero.AutoZotBib.init(); }, false);
