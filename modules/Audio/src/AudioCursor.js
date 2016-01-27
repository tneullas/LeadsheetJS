define([
	'modules/Edition/src/ElementManager',
	'modules/Cursor/src/CursorModel'
], function(ElementManager, CursorModel) {
	function AudioCursor(audioDrawer, viewer, noteMng, cursorNotes) {
		this.CL_TYPE = 'CURSOR';
		this.CL_NAME = 'audioCursor';
		this.audioDrawer = audioDrawer;
		this.viewer = viewer;
		this.elemMng = new ElementManager();
		//if we update note cursor, we'll need both, if only one is passed, fail
		if (!!this.noteMng && !this.cursorNotes || !this.noteMng && !!this.cursorNotes) {
			throw "AudioCursor: notesMng and cursorNotes must be both defined or both undefined";
		}

		this.noteMng = noteMng;
		this.cursorNotes = cursorNotes;

		this._initSubscribe();
	};


	AudioCursor.prototype._initSubscribe = function() {
		var self = this;
		$.subscribe('WaveDrawer-audioDrawn', function() {
			self.cursor = new CursorModel(self.audioDrawer.audioLjs.getDuration());
			//if there is no canvasLayer we don't paint cursor
			if (self.viewer.canvasLayer) {
				self.viewer.canvasLayer.addElement(self);
				self.updateCursorPlaying(0);
				self.viewer.canvasLayer.refresh();
			}

		});
		$.subscribe("ToWave-setCursor", function(el, cursorStart, cursorEnd) {
			var beats = self.audioDrawer.songModel.getComponent('notes').getBeatIntervalByIndexes(cursorStart, cursorEnd);
			var startTime = self.audioDrawer.audioLjs.beatDuration * (beats[0] - 1);
			if (self.cursor) {
				self.cursor.setPos([startTime, startTime]); //we equal cursor start and end cursor, because this way the player won't loop
				self.updateCursorPlaying(startTime);
			}
		});

		$.subscribe('Audio-play', function(el, audio) {
			self.restartAnimationLoop(audio);
		});
		$.subscribe('Audio-stop', function(el, audio) {
			if (self.animationId) {
				window.cancelAnimationFrame(self.animationId);
				self.animationId = null;
			}
		});
	};

	/**
	 * 
	 * @param  {Object} coords  
	 * @param  {Integer} ini  initial cursor position
	 * @param  {Integer} end  end cursor position
	 * @param  {Boolean} clicked is not used (it is just to respect the parameter order, as this function is called on other objects)
	 * @param  {Boolean} mouseUp
	 */
	AudioCursor.prototype.onSelected = function(coords, ini, end, clicked, mouseUp) {
		var self = this;
		var cursorBars = this.elemMng.getElemsInPath(this.audioDrawer.waveBarDimensions, coords, ini, end, this.getYs(coords));
		var ys = this.getYs(coords);

		end = end || ini;

		if (cursorBars[0] != null && cursorBars[1] != null) {
			var x1, x2;
			if ((this.elemMng.fromLeftBottom2TopRight(ini, end) || this.elemMng.fromTopRight2BottomLeft(ini, end)) && this.elemMng.includesMultipleLines(ys)) {
				x1 = coords.xe;
				x2 = coords.x;
			} else {
				x1 = coords.x;
				x2 = coords.xe;
			}
			var pos1 = this._getAudioTimeFromPos(x1, cursorBars[0]);
			var pos2 = this._getAudioTimeFromPos(x2, cursorBars[1]);
			this.cursor.setPos([pos1, pos2]);
			this.updateCursorPlaying(pos1, cursorBars[0]);
		}
		if (mouseUp) {
			var posCursor = this.cursor.getPos();
			if (posCursor[0] != posCursor[1]) { //if there is something selected
				$.publish('WaveDrawer-selectedAudio', posCursor);
			}
		}
	};
	AudioCursor.prototype.getType = function() {
		return this.CL_TYPE;
	};
	/**
	 * @interface
	 */
	AudioCursor.prototype.getYs = function(coords) {
		return this.elemMng.getYs(this.audioDrawer.waveBarDimensions, coords);
	};

	// WaveDrawer is a CanvasLayer element, so here, enabled means that user is interacting with it (selecting parts of the wave audio)
	/**
	 * @interface
	 */
	AudioCursor.prototype.isEnabled = function() {
		return this.enabled;
	};

	/**
	 * @interface  			
	 */
	AudioCursor.prototype.enable = function() {
		this.enabled = true;
	};

	/**
	 * @interface
	 */
	AudioCursor.prototype.disable = function() {
		this.enabled = false;
	};

	/**
	 * @interface
	 * @param  {Object} ctx Object that usually contain mouse position
	 * @return {Boolean}     Boolean indicates if coords position is on wave or not
	 */
	AudioCursor.prototype.inPath = function(coords) {
		return !!this.elemMng.getElemsInPath(this.audioDrawer.waveBarDimensions, coords);
	};

	AudioCursor.prototype.drawPlayingCursor = function(ctx) {
		ctx.beginPath();
		ctx.moveTo(this.cursorPos.x, this.cursorPos.y);
		ctx.lineTo(this.cursorPos.x, this.cursorPos.y + this.cursorPos.h);
		ctx.stroke();
	};
	/**
	 * @interface
	 * @param  {CanvasContext} ctx
	 */
	AudioCursor.prototype.drawCursor = function(ctx) {
		var saveFillColor = ctx.fillStyle;
		ctx.fillStyle = "#9900FF";
		ctx.globalAlpha = 0.2;
		var areas = this.getAreasFromTimeInterval(this.cursor.getStart(), this.cursor.getEnd());
		for (i = 0, c = areas.length; i < c; i++) {
			ctx.fillRect(
				areas[i].x,
				areas[i].y,
				areas[i].w,
				areas[i].h
			);
		}
		ctx.fillStyle = saveFillColor;
		ctx.globalAlpha = 1;
	};

	AudioCursor.prototype.setCursorEditable = function(bool) {
		if (this.cursor) {
			this.cursor.setEditable(bool);
		}
	};

	AudioCursor.prototype.updateCursorPlaying = function(time, barIndex) {
		this.cursorPos = this._getAudioPosFromTime(time, barIndex);
	};

	/**
	 * @param  {Float} time      in seconds (e.g. 4.54)
	 * @param  {Integer} barIndex number of bar in which the cursor is (should be previously calculated)
	 * @return {Object}          e.g. { x: 12, y: 23, w:5, h:5}
	 */
	AudioCursor.prototype._getAudioPosFromTime = function(time, barIndex) {
		barIndex = barIndex || this.audioDrawer.barTimesMng.getBarIndexByTime(time);
		var timeBoundaries = this.audioDrawer.barTimesMng.getTimeLimits(barIndex);
		var timeDist = timeBoundaries.end - timeBoundaries.start;
		var dim = this.audioDrawer.waveBarDimensions[barIndex].getArea();
		var percent = (time - timeBoundaries.start) / (timeBoundaries.end - timeBoundaries.start);
		var newDim = {};
		newDim.y = dim.y + this.audioDrawer.marginCursor;
		newDim.h = dim.h - this.audioDrawer.marginCursor * 2;
		newDim.x = dim.x + percent * dim.w;
		newDim.w = dim.w;
		return newDim;
	};
	/**
	 * @param  {Integer} x        coordinate x
	 * @param  {Integer} barIndex number of bar in which the cursor is (should be previously calculated)
	 * @return {Float}  time in seconds (e.g. 3.94)
	 */
	AudioCursor.prototype._getAudioTimeFromPos = function(x, barIndex) {
		var timeBoundaries = this.audioDrawer.barTimesMng.getTimeLimits(barIndex);
		var timeDist = timeBoundaries.end - timeBoundaries.start;

		var barDim = this.viewer.scaler.getScaledObj(this.audioDrawer.waveBarDimensions[barIndex].getArea());
		var percentPos = (x - barDim.x) / barDim.w;

		return percentPos * timeDist + timeBoundaries.start;
	};

	AudioCursor.prototype.getAreasFromTimeInterval = function(startTime, endTime) {
		var barTimesMng = this.audioDrawer.barTimesMng;
		var startBar = barTimesMng.getBarIndexByTime(startTime);
		var endBar = barTimesMng.getBarIndexByTime(endTime);
		var areas = this.elemMng.getElementsAreaFromCursor(this.audioDrawer.waveBarDimensions, [startBar, endBar]);
		var cursor1 = this._getAudioPosFromTime(startTime, startBar);
		var cursor2 = this._getAudioPosFromTime(endTime, endBar);
		if (cursor1.x != cursor2.x) {
			if (cursor1.x > areas[0].x && cursor1.x < areas[0].x + areas[0].w) {
				var space = cursor1.x - areas[0].x;
				areas[0].x = cursor1.x;
				areas[0].w -= space;
			}
			var lastArea = areas[areas.length - 1];

			if (cursor2.x > lastArea.x && cursor2.x < lastArea.x + lastArea.w) {
				lastArea.w = cursor2.x - lastArea.x;
			}
		} else {
			areas = [];
		}
		return areas;
	};
	AudioCursor.prototype._updateNoteCursor = function(currTime, timeStep, minBeatStep, beatDuration, prevINote) {

		if (currTime >= timeStep + minBeatStep) {

			//we update note cursor
			iNote = this.noteMng.getPrevIndexNoteByBeat(currTime / beatDuration + 1);

			if (iNote != prevINote && iNote < this.cursorNotes.getListLength()) { //if cursorNotes is not defined (or null) we don't use it (so audioPlayer works and is not dependent on cursor)
				this.cursorNotes.setPos(iNote);
				prevINote = iNote;
			}
			timeStep += minBeatStep;

		}
		return {
			timeStep: timeStep,
			prevINote: prevINote
		};
	};
	AudioCursor.prototype.restartAnimationLoop = function(audio) {

		var self = this;
		//var noteMng = this.songModel.getComponent('notes');
		// var iNote = 0,
		var prevINote = 0;
		// 	time;
		var beatDuration = this.audioDrawer.audioLjs.beatDuration;
		var minBeatStep = beatDuration / 32; //we don't want to update notes cursor as often as we update audio cursor, to optimize we only update note cursor every 1/32 beats
		var requestFrame = window.requestAnimationFrame ||
			window.webkitRequestAnimationFrame;
		//this.startTime = this.model.audio.currentTime;
		var timeStep = 0;
		var barIndex = 0;
		var currTime, r;

		var frame = function() {
			currTime = audio.getCurrentTime();
			//we don't pass barIndex as 2nd param (which would optimize function), becuase it only works forward, not backwards (which is the case if we set loop dinamically)
			barIndex = self.audioDrawer.barTimesMng.getBarIndexByTime(currTime); 
			if (self.noteMng) {
				// console.log(currTime);
				// console.log(barIndex);
				r = self._updateNoteCursor(currTime, timeStep, minBeatStep, beatDuration, prevINote);
				timeStep = r.timeStep;
				prevINote = r.prevINote;
			}


			// To avoid problems when finishing audio, we play while barIndex is in barTimesMng, if not, we pause
			if (barIndex < self.audioDrawer.barTimesMng.getLength()) {
				self.updateCursorPlaying(currTime, barIndex);
				self.viewer.canvasLayer.refresh();
				self.animationId = requestFrame(frame);
			}
		};
		frame();
	};

	return AudioCursor;
});