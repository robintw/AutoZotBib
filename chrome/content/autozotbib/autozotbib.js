Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");

function dp(s)
{
	dump(s);
}

var prefsEvent = {
	observe: function(subject, topic, data) {
     if (topic != "nsPref:changed")
     {
       return;
     }

     //dp(subject + "\t" + topic + "\t" + data + "\n");
     switch (data)
     {
     	case "bibtex_filename":
	     	// The filename we should export to has changed
	     	// Thus we need to do a full export - so that we can then add/remove
	     	// things from it.
	     	// (but only if we're in automatic mode - otherwise we shouldn't touch it!)
	     	if (Zotero.AutoZotBib.prefs.getBoolPref('automatic'))
	     	{
	     		Zotero.AutoZotBib.exportAll();
	     	}
	     	break;
	    case "automatic":
	    	// If we have just switched the automatic mode on
	    	// then do a full export - as we don't know what
	    	// happened while it was off!
	    	if (Zotero.AutoZotBib.prefs.getBoolPref('automatic'))
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
  	if (Zotero.AutoZotBib.events_timestamp.length == 0)
  	{
  		return(true);
  	}
  	else
  	{
  		return(false);
  	}
  },

  observe: function(subject, topic, data) {
  	if (Zotero.AutoZotBib.events_timestamp.length > 0)
  	{
  		Zotero.AutoZotBib.lastTimestamp = Zotero.AutoZotBib.events_timestamp[Zotero.AutoZotBib.events_timestamp.length - 1];
  	}
    currentTimestamp = new Date().getTime() / 1000;

    diff = currentTimestamp - Zotero.AutoZotBib.lastTimestamp;
    dp("Fired timer\tCurrent: " + currentTimestamp + "\tLast: " + Zotero.AutoZotBib.lastTimestamp + "\tDiff: " + diff + "\n");
    if (diff < Zotero.AutoZotBib.DIFF_DO_NOTHING)
    {
    	return;
    }
    if (diff > Zotero.AutoZotBib.DIFF_CLEAR_QUEUE && diff < Zotero.AutoZotBib.DIFF_STOP_TIMER && this.queueEmpty() == false)
    {
    	// Process queue, clear queue and process items
    	var uniques = Zotero.AutoZotBib.processQueue();

    	dp("Clearing queue\n");
    	// Zotero.AutoZotBib.events_id.length = 0;
    	Zotero.AutoZotBib.authors.length = 0
    	Zotero.AutoZotBib.years.length = 0
    	Zotero.AutoZotBib.events_type.length = 0;
    	Zotero.AutoZotBib.events_timestamp.length = 0;

    	dp("About to process items:\t");
    	dp(uniques.authors);
    	dp("\n");
    	dp("----------------------------------------------------------------\n");
    	Zotero.AutoZotBib.processItems(uniques.authors, uniques.years);


    }
    if (diff > Zotero.AutoZotBib.DIFF_STOP_TIMER)
    {
    	// Stop timer
    	dp("Stopping timer\n");
    	Zotero.AutoZotBib.timer.cancel();
    	Zotero.AutoZotBib.timerRunning = false;
    }
  }
}

Zotero.AutoZotBib = {
	timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),

	prefs: Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.autozotbib."),
	prefs_window_ref: 0,

	TYPE_REPEATING_PRECISE_CAN_SKIP: Components.interfaces.nsITimer.TYPE_REPEATING_PRECISE_CAN_SKIP,

	DIFF_DO_NOTHING: 1,
	DIFF_CLEAR_QUEUE: 5,
	DIFF_STOP_TIMER: 20,

	events_id: [],
	events_type: [],
	events_timestamp: [],

	authors: [],
	years: [],

	okToWriteToBibtex: true,
	needToAppendStill: false,

	lastTimestamp: undefined,
	timerRunning: false,

	search_results: [],


	init: function () {		
		// Register the callback in Zotero as an item observer
		var notifierID = Zotero.Notifier.registerObserver(this.notifierCallback, ['item']);

		// Unregister callback when the window closes (important to avoid a memory leak)
		window.addEventListener('unload', function(e) {
				Zotero.Notifier.unregisterObserver(notifierID);
		}, false);

		Zotero.addShutdownListener(this.onShutdown);


		this.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
		this.prefs.addObserver("", prefsEvent, false);
	},

	onShutdown: function() {
		dp("\n######## We're about to shutdown - clear queue and process.\n\n");
    	// Process queue, clear queue and process items
    	var uniques = Zotero.AutoZotBib.processQueue();

    	// Zotero.AutoZotBib.events_id.length = 0;
    	Zotero.AutoZotBib.authors.length = 0
    	Zotero.AutoZotBib.years.length = 0
    	Zotero.AutoZotBib.events_type.length = 0;
    	Zotero.AutoZotBib.events_timestamp.length = 0;

    	Zotero.AutoZotBib.processItems(uniques.authors, uniques.years);
	},
	
	preferences: function(w) {
    	if (! this.prefs_window_ref || this.prefs_window_ref.closed) this.prefs_window_ref = w.open("chrome://autozotbib/content/preferences.xul", "", "centerscreen,chrome,dialog,resizable");
    	else this.prefs_window_ref.focus();
  	},
	
	/* Process the queue of events
	and decide which item IDs should be processed
	*/
  	processQueue: function() {
  		// Very simple (but effective - I think) way of doing it
  		// at the moment just selects unique itemIDs from those in the
  		// queue.

  		// First ensure all itemIDs are numbers (some weren't for some reason)
  		//this.events_id = this.events_id.map(function(x) {return Number(x);});

  		// Get the unique ones
  		uniques = this.uniqueElementsAuthorYear(this.authors, this.years);

  		return(uniques);
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
		dp("In append to file. Items = \t");
		dp(ids);
		dp("\n");

		items = Zotero.Items.get(ids);

		var translation = new Zotero.Translate.Export();
		translation.setItems(items);
		trans_guid = this.prefs.getCharPref("bibtex_translator_guid");
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
			dp("Error exporting items to BibTeX.\n");
			window.alert("Error exporting items to BibTeX.\n");
		} else {
			var bibtexString = obj.string;

			var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
			var filename = Zotero.AutoZotBib.prefs.getCharPref("bibtex_filename");
			file.initWithPath(filename);

			// You can also optionally pass a flags parameter here. It defaults to
			// FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE;
			var ostream = FileUtils.openFileOutputStream(file, FileUtils.MODE_WRONLY | FileUtils.MODE_APPEND);
			 
			var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
			                createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
			converter.charset = "UTF-8";
			var istream = converter.convertToInputStream(bibtexString);
			 
			// The last argument (the callback) is optional.
			NetUtil.asyncCopy(istream, ostream, function(status) {
			  if (!Components.isSuccessCode(status)) {
			    // Handle error!
			    return;
			  }
			 
			  // Data has been written to the file.
			  dp("Data has been appended to the file.\n");
			});
		}
	},

	/*
	Removes ALL entries with the given first author
	and year from the Bibtex file specified in the preferences
	*/
  	removeBibtexEntries: function(authors, years) {
  		dp("Inside removeBibTeXEntries")
  		this.okToWriteToBibtex = false;
		var file = Components.classes["@mozilla.org/file/local;1"].
	           createInstance(Components.interfaces.nsILocalFile);

	    var filename = this.prefs.getCharPref("bibtex_filename");
		file.initWithPath(filename);


		NetUtil.asyncFetch(file, function(inputStream, status) {
		  if (!Components.isSuccessCode(status)) {
		    // Handle error!
		    dp("Error in reading file!\n");
		    return;
		  }
		  // Read file into a string variable called data
		  fileString = NetUtil.readInputStreamToString(inputStream, inputStream.available());


		  // Add a new fake entry starting with @ at the end so that the regexp
		  // works for the final entry in the file
		  fileString = fileString + "\n\n@REPLACETHIS"

		  dp("Before for loop")
		  // For every author and year given, remove those from the string
		  for (var i = 0; i < authors.length; i++)	
		  {
		  	dp("Removing:\n")
		  	dp(authors[i])
		  	dp("\n")
		  	// Remove the BibTeX entry given as arguments to this function
		  	// by using a regexp
		  	fileString = fileString.replace(new RegExp('@[^@]+?author = \{(' + authors[i] + '),[^@]+?year = \{(' + years[i] + ')\}[^@]+?(?=@)','g'), "")
		  }

		  // Remove the @REPLACETHIS bit as it is invalid BibTex!
		  fileString = fileString.replace('@REPLACETHIS', '')

		  // You can also optionally pass a flags parameter here. It defaults to
		  // FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE;
		  var ostream = FileUtils.openSafeFileOutputStream(file);
		 
		  var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
		                createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
		  converter.charset = "UTF-8";
		  var istream = converter.convertToInputStream(fileString);
		 
		  // The last argument (the callback) is optional.
		  NetUtil.asyncCopy(istream, ostream, function(status) {
		    if (!Components.isSuccessCode(status)) {
		      // Handle error!
		      dp("Error writing file.\n")
		      return;
		    }
		 
		  // Data has been written to the file.
		  dp("BibTeX entries have been removed. Value of ntas is:\t");
		  dp(Zotero.AutoZotBib.needToAppendStill);
		  dp("\n");

		  if (Zotero.AutoZotBib.needToAppendStill == true)
		  {
		  	dp("Need to append still is true!")
		  	// Export all of the entries that we found in the search and
			// append to the file
			dp("LATER ON Appending items to file.\n");
			Zotero.AutoZotBib.appendItemsToFile(Zotero.AutoZotBib.search_results);
			Zotero.AutoZotBib.needToAppendStill = false;
			Zotero.AutoZotBib.search_results.length = 0;
		  }
		  this.okToWriteToBibtex = true;
		});
		});
	},

	exportItems: function(items, filename) {
		dp("In exportItems\n");
		dp(items);

		var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
		file.initWithPath(filename);
		
		var translator = new Zotero.Translate('export');
		trans_guid = this.prefs.getCharPref("bibtex_translator_guid");
		//translator.setTranslator('DA47106C-1265-4D19-8E75-0A4CD77CD369'); // BibTeX
		translator.setTranslator(trans_guid);
		translator.setItems(items);
		translator.setLocation(file);
		translator.translate();
	},

	exportAll: function() {
		var all_items = Zotero.Items.getAll(true)
		var filename = this.prefs.getCharPref("bibtex_filename");

		this.exportItems(all_items, filename);
  	},

  	// Returns an array containing the elements
  	// from arr at indices inds
  	subset: function(arr, inds) {
  		var newArr = []
  		for (var i = 0; i < inds.length; i++)
  		{
  			newArr.push(arr[inds[i]]);
  		}
  		return newArr;
  	},

  	// Returns just the unique elements from the array for AUTHORs and YEARs
  	// Taken from http://net.tutsplus.com/tutorials/javascript-ajax/javascript-from-null-utility-functions-and-debugging/
  	uniqueElementsAuthorYear: function(authors, years) {
  	var joinedArr = []
    var newAuthors = []
    var newYears = []
  	for (var i = 0; i < authors.length; i++)
  	{
  		joinedArr.push(authors[i] + "," + years[i])
  	}
    var newArr = [],
    	origLen = joinedArr.length,
        found,
        x, y;
    for ( x = 0; x < origLen; x++ ) {
        found = undefined;
        for ( y = 0; y < newArr.length; y++ ) {
            if ( joinedArr[x] === newArr[y] ) {
              found = true;
              break;
            }
        }
        if ( !found) {
        	newArr.push( joinedArr[x] );
        }
    }
   for (var i = 0; i < newArr.length; i++)
    {
      spl = newArr[i].split(",")
      newAuthors.push(spl[0])
      newYears.push(spl[1])
    }
   return {authors:newAuthors, years:newYears};
   },

   // Returns just the unique elements from the array
  	// Taken from http://net.tutsplus.com/tutorials/javascript-ajax/javascript-from-null-utility-functions-and-debugging/
  	uniqueElements: function(origArr) {
    var newArr = [],
        origLen = origArr.length,
        found,
        x, y;
    var indices = []
    for ( x = 0; x < origLen; x++ ) {
        found = undefined;
        for ( y = 0; y < newArr.length; y++ ) {
            if ( origArr[x] === newArr[y] ) {
              found = true;
              break;
            }
        }
        if ( !found) {
        	newArr.push( origArr[x] );
        	indices.push(x);
        }
    }
   return {unique: newArr, indices: indices};
   },
	
	processItems: function(authors, years) {
		// Processes items that have changed (add/modify/delete)
		dp("In processItems\n");
		// var authors = [];
		// var years = [];

		// // Get authors and years from the ids
		// for (i in ids)
		// {
		// 	// Get the item
		// 	var item = Zotero.Items.get(ids[i]);
		// 	// Get the author
		// 	var creators = item.getCreators();
		// 	authors.push(creators[0].ref.lastName);

		// 	// Get the year
		// 	var date_str = item.getField('date');
		// 	var date_obj = Zotero.Date.strToDate(date_str);
		// 	years.push(date_obj.year);
		// }

		dp(authors);
		dp("\n");
		dp(years);

		// Remove all entries with these authors and years from the BibTeX file
		// We can call removeBibtexEntries with a list of authors and list of years
		// and it will do it for all of them (more efficient than reading/writing
		// file many times).
		dp("Calling removeBibtexEntries\n");
		this.removeBibtexEntries(authors, years);

		// Search Zotero library for items with those authors and years
		// (each call to searchItems does it for one author/year combo,
		// run many times and join results - then remove any duplicates)	
		for (var i = 0; i < authors.length; i++)
		{
			var author = authors[i];
			var year = years[i];

			var results = this.searchItems(author, year);
			dp("Searching for ")
			dp(author)
			dp(", ")
			dp(year)
			dp("\n")
			if (results == false)
			{
				continue;
			}

			this.search_results = this.search_results.concat(results);
		}

		res = this.uniqueElements(this.search_results)

		this.search_results = this.subset(this.search_results, res.indices)

		dp("All search results are:\t");
		dp(this.search_results);
		dp("\n");

		if (this.search_results.length == 0)
		{
			dp("## No search results, therefore nothing to add.")
			return;
		}

		if (this.okToWriteToBibtex)
		{
			// Export all of the entries that we found in the search and
			// append to the file
			dp("It's ok to write to the file\n");
			dp("About to append items to file.\n");
			this.appendItemsToFile(this.search_results);
			this.search_results.length = 0;
		}
		else
		{
			dp("NOT ok to write to the file. Will do later.\n")
			this.needToAppendStill = true;
			dp("The value of needToAppendStill is:\t");
			dp(Zotero.AutoZotBib.needToAppendStill);
			dp("\n");
		}

		
	},

	// Callback implementing the notify() method to pass to the Notifier
	notifierCallback: {
	    notify: function(event, type, ids, extraData) {

		if (Zotero.AutoZotBib.prefs.getBoolPref("automatic") == false || Zotero.AutoZotBib.prefs.getCharPref("bibtex_filename") == "" || type != "item")
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
		if (ids.length > 0)
		{
			Zotero.AutoZotBib.events_timestamp.push(secs);
			Zotero.AutoZotBib.events_type.push(event);

			// if (ids.length > 1)
			// {
			// 	Zotero.AutoZotBib.events_id.concat(ids);
			// }
			// else
			// {
			// 	Zotero.AutoZotBib.events_id.push(ids);
			// }

			// dp(Zotero.AutoZotBib.events_timestamp.join());
			dp("Type is: \n");
			dp(Zotero.AutoZotBib.events_type.join());
			dp("\n");
			// dp("\n");
			// dp(JSON.stringify(extraData));
			// dp("\n");
			// dp(Zotero.AutoZotBib.events_id.join());
			// dp("\n");
			// dp("\n");

			var changes = extraData[ids[0]].changed;
			dp(JSON.stringify(changes));
			dp("\n");
			dp(typeof changes);
			dp("\n");
			dp(changes.prototype.toString);
			dp("\n");

			// Get authors and years from the ids
			for (i in ids)
			{
				// Get the item
				var item = Zotero.Items.get(ids[i]);
				// Get the author
				var creators = item.getCreators();
				Zotero.AutoZotBib.authors.push(creators[0].ref.lastName);

				// Get the year
				var date_str = item.getField('date');
				var date_obj = Zotero.Date.strToDate(date_str);
				Zotero.AutoZotBib.years.push(date_obj.year);

				// Check the associated extraData
				// if the creators or date has changed then
				// add the old ones as well
				var changes = extraData[i];

			}
			dp("Authors then years:\n")
			dp(Zotero.AutoZotBib.authors);
			dp("\n");
			dp(Zotero.AutoZotBib.years);

		}
		
		if (Zotero.AutoZotBib.timerRunning == false)
		{
			Zotero.AutoZotBib.timer.init(timerEvent, 1000, Zotero.AutoZotBib.TYPE_REPEATING_PRECISE_CAN_SKIP);
			Zotero.AutoZotBib.timerRunning = true;
		}

	    }
	}
};

// Initialize the utility
window.addEventListener('load', function(e) { Zotero.AutoZotBib.init(); }, false);
