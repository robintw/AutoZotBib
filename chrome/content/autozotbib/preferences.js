var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.autozotbib.");

function chooseFile() {
	var nsIFilePicker = Components.interfaces.nsIFilePicker;
	var fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
	fp.init(window, "Select the file to save the Bibtex output in", nsIFilePicker.modeSave);

	var res = fp.show();

	if (res != nsIFilePicker.returnCancel) {
		var filename = fp.file.path;

		return filename;
	}
	else
	{
		return '';
	}
}