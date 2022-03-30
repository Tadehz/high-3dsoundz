var Config = {};
var audioElements = [];
var panners = [];
var biquadFilters = [];
var gainNodes = [];
var transitionIntervals = [];
var volumeTransitionIntervals = [];

$(document).ready(function() {
    $.post(`https://${GetParentResourceName()}/nuiLoaded`, JSON.stringify({}));
});

function getFileFormat(song) {
    return new Promise((resolve, reject) => {
        for(const format of Config.SupportedAudioFormats) {
            let tempAudio = new Audio(`${song}.${format}`);
            tempAudio.oncanplay = function() {
                resolve(format)
            }
        }
        setTimeout(() => {
            resolve(false)
        }, 2000);
    });
}

function isFormatSpecified(song) {
    return new Promise((resolve, reject) => {
        for(const format of Config.SupportedAudioFormats) {
            if(song.includes("." + format)) {
                resolve(true);
            }
        }
        resolve(false);
    });
}

/*
  0 - Create sound
  1 - Update sound data
  2 - Destroy sound
  3 - Play/Pause sound
  4 - Set field to value
  5 - Repeat song
  6 - Receive config
*/
window.addEventListener("message", async function(event) {
    let e = event.data
    if(e.action == 0) {
        e.panner = e.panner.toFixed(2)
        e.volume = e.volume.toFixed(2)
        const audioCtx = new AudioContext();
        let finalUrl = "";
        let formatSpecified = await isFormatSpecified(e.song);
        if(formatSpecified) {
            audioElements[e.soundId] = new Audio(e.song);
            finalUrl = e.song;
            $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onCreated"}));
        } else {
            let format = await getFileFormat(e.song)
            if(format) {
                audioElements[e.soundId] = new Audio(`${e.song}.${format}`);
                finalUrl = e.song + "." + format;
                $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onCreated"}));
            } else {
                console.log("ERROR: File '" + e.song + ".*' not found in any of the formats available.")
                return $.post(`https://${GetParentResourceName()}/soundEnded`, JSON.stringify({soundId: e.soundId}));
            }
        }
        
        audioElements[e.soundId].oncanplay = function() {
            $.post(`https://${GetParentResourceName()}/updateSound`, JSON.stringify({soundId: e.soundId, table: [
                {field: "playing", value: true}, 
                {field: "src", value: finalUrl},
                {field: "duration", value: audioElements[e.soundId].duration}
            ]}));

            $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onPlay"}));
        }

        const track = audioCtx.createMediaElementSource(audioElements[e.soundId]);
        if(e.startsAt) audioElements[e.soundId].currentTime = e.startsAt;

        panners[e.soundId] = new StereoPannerNode(audioCtx, {pan: 0});

        gainNodes[e.soundId] = audioCtx.createGain();
        biquadFilters[e.soundId] = audioCtx.createBiquadFilter();
        biquadFilters[e.soundId].connect(audioCtx.destination);
        track.connect(panners[e.soundId]).connect(gainNodes[e.soundId]).connect(biquadFilters[e.soundId]).connect(audioCtx.destination);

        panners[e.soundId].pan.value = e.panner;
    
        audioElements[e.soundId].loud = e.loud;
        if(e.loud) {
            biquadFilters[e.soundId].type = "allpass";
            biquadFilters[e.soundId].frequency.value = 10000;
            gainNodes[e.soundId].gain.value = 1.0;
        } else {
            biquadFilters[e.soundId].type = "lowpass";
            biquadFilters[e.soundId].frequency.value = 200;
            gainNodes[e.soundId].gain.value = Config.MuffleEfectGain;
        }

        audioElements[e.soundId].volume = e.volume;
        audioElements[e.soundId].play();

        audioElements[e.soundId].onended = (event) => {
            $.post(`https://${GetParentResourceName()}/soundEnded`, JSON.stringify({soundId: e.soundId}))
            $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onFinished"}));
            if(audioElements[e.soundId].destroyOnFinish) {
                delete audioElements[e.soundId];
                delete panners[e.soundId];
                delete biquadFilters[e.soundId];
                delete gainNodes[e.soundId];
                delete transitionIntervals[e.soundId];
                delete volumeTransitionIntervals[e.soundId];
            }
        }
    } else if(e.action == 1) {
        e.sounds.forEach((sound) => {
            if(!audioElements[sound.soundId]) return;

            sound.panner = typeof(sound.panner) != "number" ? Math.cos(((e.rotZ % 360) * Math.PI / 180) - Math.atan2(sound.panner.y, sound.panner.x)).toFixed(2) : sound.panner.toFixed(2);
            sound.volume = (sound.volume*e.gameVolume).toFixed(2);
    
            if(sound.panner > 1.0)
                sound.panner = 1.0;
            else if(sound.panner < -1.0)
                sound.panner = -1.0;
    
            if(sound.volume > 0.00) {
                let difference = (panners[sound.soundId].pan.value - sound.panner).toFixed(3)
                let step = (difference / 10).toFixed(3)
                difference = Math.abs(difference)
                if(difference > 0.1) {
                    if(transitionIntervals[sound.soundId]) clearInterval(transitionIntervals[sound.soundId]);
                    transitionIntervals[sound.soundId] = setInterval(() => {
                        if(panners[sound.soundId] && difference > Math.abs(step) && panners[sound.soundId].pan.value >= -1.00 && panners[sound.soundId].pan.value <= 1.00) {
                            let newValue = panners[sound.soundId].pan.value - step
                            if(newValue >= -1.00 && newValue <= 1.00)
                                panners[sound.soundId].pan.value = newValue;
                            else if(newValue < -1.00)
                                panners[sound.soundId].pan.value = -1.00
                            else if(newValue > 1.00)
                                panners[sound.soundId].pan.value = 1.00
                                
                            difference -= Math.abs(step);
                        } else {
                            clearInterval(transitionIntervals[sound.soundId])
                            transitionIntervals[sound.soundId] = undefined;
                        }
                    }, 10);
                } else {
                    panners[sound.soundId].pan.value = sound.panner
                }
            }
            
            if(sound.volume < 0.00)
                sound.volume = 0.0;
            else if(sound.volume > 1.00)
                sound.volume = 1.0;
            
            volumeFadeTo(100, sound.soundId, sound.volume);
    
            if(!sound.loud && audioElements[sound.soundId].loud) {
                if(!e.noLoudTransition) {
                    fadeOut(500, sound.soundId)
                } else {
                    biquadFilters[soundId].type = "lowpass";
                    biquadFilters[soundId].frequency.value = 200;
                    gainNodes[soundId].gain.value = Config.MuffleEfectGain;
                }
                audioElements[sound.soundId].loud = false;
            } else if(sound.loud && !audioElements[sound.soundId].loud) {
                if(!e.noLoudTransition) {
                    fadeIn(500, sound.soundId)
                } else {
                    biquadFilters[soundId].type = "allpass";
                    biquadFilters[soundId].frequency.value = 10000;
                    gainNodes[soundId].gain.value = 1.0;
                } 
                audioElements[sound.soundId].loud = true;
            }
        })

    } else if(e.action == 2) {
        if(audioElements[e.soundId])
            audioElements[e.soundId].pause();

        delete audioElements[e.soundId];
        delete panners[e.soundId];
        delete biquadFilters[e.soundId];
        delete gainNodes[e.soundId];
        delete transitionIntervals[e.soundId];
        delete volumeTransitionIntervals[e.soundId];
    } else if(e.action == 3) {
        if(!audioElements[e.soundId]) return;

        if(e.paused) {
            audioElements[e.soundId].pause();
            $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onPause"}));
        } else {
            audioElements[e.soundId].play();
            $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onResume"}));
        }
    } else if(e.action == 4) {
        if(!audioElements[e.soundId]) return;

        if(e.field != "src") {
            audioElements[e.soundId][e.field] = e.value;
        } else if(e.field == "src") {
            let finalUrl = "";
            let formatSpecified = await isFormatSpecified(e.value);
            if(formatSpecified) {
                audioElements[e.soundId].src = e.value;
                finalUrl = e.value;
            } else {
                let format = await getFileFormat(e.value)
                if(format) {
                    audioElements[e.soundId].src = e.value + "." + format;
                    finalUrl = e.value + "." + format;
                } else {
                    return console.log("ERROR: File '" + e.value + ".*' not found in any of the formats available.");
                }
            }

            audioElements[e.soundId].oncanplay = function() {
                $.post(`https://${GetParentResourceName()}/updateSound`, JSON.stringify({soundId: e.soundId, table: [
                    {field: "playing", value: true}, 
                    {field: "src", value: finalUrl},
                    {field: "duration", value: audioElements[e.soundId].duration}
                ]}));
    
                $.post(`https://${GetParentResourceName()}/emitSoundEvent`, JSON.stringify({soundId: e.soundId, event: "onPlay"}));
            }
    
            audioElements[e.soundId].play();
        }
    } else if(e.action == 5) {
        if(!audioElements[e.soundId]) return;

        audioElements[e.soundId].currentTime = 0;
        audioElements[e.soundId].play();
    } else if(e.action == 6) {
        Config = e.config;
    }
});

var fadeInIntervals = [];
function fadeIn(time, soundId) {
    if(fadeInIntervals[soundId]) return;
    if(fadeOutIntervals[soundId]) { 
        clearInterval(fadeOutIntervals[soundId])
        delete fadeOutIntervals[soundId];
    }

    gainNodes[soundId].gain.value = 1.0;
    fadeInIntervals[soundId] = setInterval(() => {
        if(biquadFilters[soundId] && biquadFilters[soundId].frequency.value < 10000) {
            biquadFilters[soundId].frequency.value += 100
        } else {
            if(biquadFilters[soundId]) biquadFilters[soundId].type = "allpass";
            clearInterval(fadeInIntervals[soundId])
            delete fadeInIntervals[soundId];
        }
    }, time / (9800) * 100);
}

var fadeOutIntervals = [];
function fadeOut(time, soundId) {
    if(fadeOutIntervals[soundId]) return;
    if(fadeInIntervals[soundId]) {
        clearInterval(fadeInIntervals[soundId])
        delete fadeInIntervals[soundId];
    }

    biquadFilters[soundId].type = "lowpass";
    fadeOutIntervals[soundId] = setInterval(() => {
        if(biquadFilters[soundId] && biquadFilters[soundId].frequency.value > 200) {
            biquadFilters[soundId].frequency.value -= 100
        } else {
            clearInterval(fadeOutIntervals[soundId])
            delete fadeOutIntervals[soundId];
        }
    }, time / (biquadFilters[soundId].frequency.value) * 100);
}

var volumeFadeIntervals = [];
function volumeFadeTo(time, soundId, newVolume) {
    if(volumeFadeIntervals[soundId] && newVolume != volumeFadeIntervals[soundId].newVolume) 
        clearInterval(volumeFadeIntervals[soundId].interval);
    else if(volumeFadeIntervals[soundId] && newVolume == volumeFadeIntervals[soundId].newVolume)
        return;

    let difference = audioElements[soundId].volume - newVolume;
    if(Math.abs(difference) < 0.05) {
        audioElements[soundId].volume = newVolume;
        return;
    }

    volumeFadeIntervals[soundId] = {newVolume: newVolume};
    if(difference < 0.0) {
        volumeFadeIntervals[soundId].interval = setInterval(() => {
            let newValue = audioElements[soundId].volume+0.01;
            if(audioElements[soundId] && audioElements[soundId].volume < newVolume && newValue < 1.00) {
                audioElements[soundId].volume = newValue;
            } else {
                audioElements[soundId].volume = newVolume;
                clearInterval(volumeFadeIntervals[soundId].interval)
                delete volumeFadeIntervals[soundId];
            }
        }, time / Math.abs(difference) * 0.01);
    } else {
        volumeFadeIntervals[soundId].interval = setInterval(() => {
            let newValue = audioElements[soundId].volume-0.01;
            if(audioElements[soundId] && audioElements[soundId].volume > newVolume && newValue > 0.00) {
                audioElements[soundId].volume = newValue
            } else {
                audioElements[soundId].volume = newVolume;
                clearInterval(volumeFadeIntervals[soundId].interval)
                delete volumeFadeIntervals[soundId];
            }
        }, time / Math.abs(difference) * 0.01);
    }
}