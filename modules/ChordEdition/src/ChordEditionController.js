define([
	'mustache',
	'modules/core/src/SongBarsIterator',
	'modules/core/src/ChordModel',
	'utils/NoteUtils',
	'modules/core/src/PitchClass',
	'utils/UserLog',
	'jquery',
	'pubsub',
], function(Mustache, SongBarsIterator, ChordModel, NoteUtils, PitchClass, UserLog, $, pubsub) {
	/**
	 * ChordEditionController manages all chords edition function
	 * @exports ChordEdition/ChordEditionController
	 */
	function ChordEditionController(songModel, cursor, chordSpaceMng) {
		if (!songModel || !cursor || !chordSpaceMng) {
			throw "ChordEditionController params are wrong";
		}
		this.songModel = songModel;
		this.cursor = cursor;
		this.chordSpaceMng = chordSpaceMng;
		this.initSubscribe();
	}

	/**
	 * Subscribe to view events
	 */
	ChordEditionController.prototype.initSubscribe = function() {
		var self = this;

		$.subscribe('ChordEditionView', function(el, fn, param) {
			if (self.chordSpaceMng.isEnabled()) {
				self[fn].call(self, param);
				$.publish('ToViewer-draw', self.songModel);
			}
		});

		$.subscribe('pasteJSONData', function(el, jsonData) {
			if (jsonData.chords && jsonData.chords.length > 0) {
				var pastedChords = [];
				for (var i = 0; i < jsonData.chords.length;i++) {
					pastedChords.push(new ChordModel(jsonData.chords[i]));
				}
				self.pasteChords(pastedChords);
				$.publish('ToViewer-draw', self.songModel);
			}
		});
	};

	ChordEditionController.prototype.setChordPitch = function(inc) {
		var chordMng = this.songModel.getComponent('chords');
		var indexes = this.getSelectedChordsIndexes();
		var chord;
		for (var i = 0; i < indexes.length; i++) {
			chord = chordMng.getChord(indexes[i]);
			chord.setNote(NoteUtils.getNextChromaticKey(chord.getNote(),inc, true));
		}
	};
	
	ChordEditionController.prototype.deleteChords = function() {

		var beats = this.getSelectedChordsBeats();
		var chordMng = this.songModel.getComponent('chords');
		var self = this;
		var firstChordSpace = chordMng.getBarNumAndBeatFromBeat(this.songModel,beats[0]);
		var lastChordSpace = chordMng.getBarNumAndBeatFromBeat(this.songModel,beats[1] - 1);
		if (lastChordSpace.exceedsSongLength){ //when we are removing last positions, we just set lastChordSpace greater than last position
			var lastChordSpaceView = this.chordSpaceMng.chordSpaces[this.chordSpaceMng.chordSpaces.length - 1];
			lastChordSpace.barNumber = lastChordSpaceView.barNumber + 1;
			lastChordSpace.beatNumber = lastChordSpaceView.beatNumber + 1;
		}
		chordMng.removeChordsBetweenPositions(firstChordSpace.barNumber, firstChordSpace.beatNumber, lastChordSpace.barNumber, lastChordSpace.beatNumber);
		
		$.publish('ToHistory-add', 'Remove chord');
	};

	ChordEditionController.prototype.toggleEditChord = function() {
		console.log('toggleEditChord');
	};

	ChordEditionController.prototype.copyChords = function() {
		var selectedChordsPos = this.getSelectedChordsBeats();
		var chordMng = this.songModel.getComponent('chords');
		// indexesBeat is an array of objects {index: 1, beat: 2} (with the index of the chord, and the beat differents to start beat of selected sections)
		var indexesBeats = chordMng.getChordsRelativeToBeat(this.songModel, selectedChordsPos[0], selectedChordsPos[1]);
		if (indexesBeats.length === 0){		
 			//no chords selected		
 			return;		
 		}
		var pos1 = indexesBeats[0].index;
		var pos2 = indexesBeats[indexesBeats.length - 1].index;
		var copiedChords = chordMng.cloneElems(pos1, pos2 + 1);
		var chords = [];
		for (var i = 0; i < copiedChords.length;i++) {
			chords.push(copiedChords[i].serialize());
			chords[i].beat = indexesBeats[i].beat;
		}
		$.publish('ClipboardManager-addToClipboardHolder', {chords: chords});
	};
 
	ChordEditionController.prototype.pasteChords = function(copiedChords) {
		var chordMng = this.songModel.getComponent('chords');
		var startPasteBeat = this.getSelectedChordsBeats()[0];
		var endPasteBeat = startPasteBeat + copiedChords[copiedChords.length - 1].beat;
		// remove chords in affected chordspaces
		var firstChordSpace = chordMng.getBarNumAndBeatFromBeat(this.songModel,startPasteBeat);
		var lastChordSpace = chordMng.getBarNumAndBeatFromBeat(this.songModel,endPasteBeat);
		if (firstChordSpace.exceedsSongLength || lastChordSpace.exceedsSongLength){
			throw "ChordEdition error exceedsSongLength";
		}
		chordMng.removeChordsBetweenPositions(firstChordSpace.barNumber, firstChordSpace.beatNumber, lastChordSpace.barNumber, lastChordSpace.beatNumber);

		//we copy chords
		var pasteBeat, numBarAndBeat, barNumAndBeat;
		for (var i = 0; i < copiedChords.length; i++) {
			pasteBeat = copiedChords[i].beat + startPasteBeat;
			barNumAndBeat = chordMng.getBarNumAndBeatFromBeat(this.songModel,pasteBeat);
			if (!barNumAndBeat.notExactBeat){
				copiedChords[i].setBarNumber(barNumAndBeat.barNumber);
				copiedChords[i].setBeat(barNumAndBeat.beatNumber);
				chordMng.addChord(copiedChords[i]);
			}
		}
		$.publish('ToHistory-add', ['Paste chord', false, [startPasteBeat, endPasteBeat]]);
	};
	
	/**
	 * returns start and end beats of chords taking into account cursor, depending on chordSpaces selected
	 * @return {Array} [startBeat, endBeat]
	 */
	ChordEditionController.prototype.getSelectedChordsBeats = function() {
		var songIt = new SongBarsIterator(this.songModel);
		var startChordSpace = this.chordSpaceMng.chordSpaces[this.cursor.getStart()];
		var startBarNum = startChordSpace.barNumber;

		songIt.setBarIndex(startBarNum);
		var beatInc = 4 / songIt.getBarTimeSignature().getBeatUnit(); //will be 1 for x/4 time signatures, 2 for x/2, and 0.5 for x/8
		var barBeatOffset = (startChordSpace.beatNumber - 1) * beatInc;
		var startBeat = this.songModel.getStartBeatFromBarNumber(startBarNum) + barBeatOffset;
		var iBeat = startBeat;

		for (var i = this.cursor.getStart(); i <= this.cursor.getEnd(); i++) {
			if (barBeatOffset === songIt.getBarTimeSignature().getQuarterBeats() && songIt.hasNext()) {
				songIt.next();
				beatInc = 4 / songIt.getBarTimeSignature().getBeatUnit();
				barBeatOffset = 0;
			} else if (barBeatOffset > songIt.getBarTimeSignature().getQuarterBeats()) {
				console.warn("barBeatOffset > total bar duration"); //should never enter here
			}
			iBeat += beatInc;
			barBeatOffset += beatInc;
		}
		return [startBeat, iBeat];
	};
	/**
	 * Returns indexes of chords depending on cursor position
	 * @return {Array} index number of selected chords. e.g. [0,1,2]
	 */
	ChordEditionController.prototype.getSelectedChordsIndexes = function() {
		var chordManager = this.songModel.getComponent('chords');
		var selectedChords = [];
		for (var cursorIndex = this.cursor.getStart(); cursorIndex <= this.cursor.getEnd(); cursorIndex++) {
			var chordSpace = this.chordSpaceMng.chordSpaces[cursorIndex];
			if (chordSpace) {
				var pos = {
					numBeat: chordSpace.beatNumber,
					numBar: chordSpace.barNumber
				};
				var r = chordManager.getChordIndexByPosition(pos);
				if (r.exact) {
					selectedChords.push(r.index);
				}
			}
		}
		return selectedChords;
	};

	return ChordEditionController;
});