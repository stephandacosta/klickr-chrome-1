/* ------------------------------------------------------------------------------------*/
/* Background Player
/* ------------------------------------------------------------------------------------*/
var BgPlayer = function(){

  this.id = ''; // klick object id (corresponds to _id in mongodb)
  this.klickQueue = [];
  this.klickTickLengths = [];
  this.stagedKlick = undefined;
  this.klickQueueIndex = -1;
  console.log('bgPlayer initiated');
  this.tabId = '';

};

window.BgPlayer = BgPlayer;

/* ------------------------------------------------------------------------------------*/
/* Popup Button Functions
/* ------------------------------------------------------------------------------------*/

/* Pause: Send pause message */
BgPlayer.prototype.pause = function(){
  console.log('Background: Pause recording');
  helpers.activeTabSendMessage({action: 'pause'});
};

BgPlayer.prototype.resume = function(num){
  this.stagedKlick = this.klickQueue[this.klickQueueIndex];
  console.log(this.stagedKlick);
  helpers.activeTabSendMessage({action: "resume", klick: this.stagedKlick, index: num});
};

BgPlayer.prototype.play = function(){
  console.log('Background -> Recorder: Play recording');
  this.stagedKlick = this.klickQueue[0];
  console.log(this.klickQueue);
  this.klickQueueIndex = 0;
  var that = this;
  chrome.tabs.query({active:true, lastFocusedWindow: true}, function(tabs){
    that.tabId = tabs[0].id;
    console.log(that.klickQueue);
    console.log('which url');
    if(tabs[0].url !== that.stagedKlick.ticks[0].url){
      console.log('diff url');
      that.redirect(that.stagedKlick.ticks[0].url);
    } else {
      console.log('same url');
      chrome.tabs.sendMessage(that.tabId, {action:'play', klick: that.stagedKlick});
      that.stagedKlick = undefined;
    }
  });
};

/* ------------------------------------------------------------------------------------*/
/* Helper Functions
/* ------------------------------------------------------------------------------------*/



BgPlayer.prototype.redirect = function(nextUrl){
  chrome.tabs.query({'active': true, 'lastFocusedWindow': true}, function (tabs) {
    chrome.tabs.update(tabs[0].id, {url: nextUrl});
  });
};

BgPlayer.prototype.getKlick = function(id){
  var that = this;
  $.ajax({
    url: Klickr.server + '/klicks/' + id,
    type: 'GET',
    contentType: 'application/json',
    success: function(rawKlick){
      that.buildKlickQueue(rawKlick);
    }
  });
};

BgPlayer.prototype.buildKlickQueue = function(rawKlick){
  var ticks = rawKlick.ticks;
  var index = 0;
  this.klickQueue[0] = this.buildSubKlick(rawKlick, ticks[0]);
  for(var i = 1; i < ticks.length; i++){
    if(ticks[i].url === ticks[i-1].url){
      this.klickQueue[index].ticks.push(ticks[i]);
    } else {
      index++;
      this.klickQueue[index] = this.buildSubKlick(rawKlick, ticks[i]);
    }
  }
  this.buildKlickTickLengths(this.klickQueue);
};

BgPlayer.prototype.buildSubKlick = function(rawKlick, tickObj){
  var subKlick = {};
  for(var key in rawKlick){
    if(key !== 'ticks'){
      subKlick[key] = rawKlick[key];
    } else {
      subKlick[key] = [tickObj];
    }
  }
  return subKlick;
};

BgPlayer.prototype.buildKlickTickLengths = function(subKlicks){
  for(var i = 0; i < subKlicks.length; i++){
    this.klickTickLengths.push(subKlicks[i].ticks.length);
  }
};

BgPlayer.prototype.getRawKlickIndex = function(queueIndex, playerIndex){
  for(var i = 0; i < queueIndex; i++){
    playerIndex += this.klickTickLengths[i]+1;
  }
  return playerIndex;
};

/* ------------------------------------------------------------------------------------*/
/* Init and Player Listeners
/* ------------------------------------------------------------------------------------*/

var bgPlayer = new BgPlayer();

chrome.tabs.onUpdated.addListener(function(){
  chrome.tabs.query({'active': true, 'lastFocusedWindow': true}, function (tabs) {
    // console.log('Background: Tab update detected', tabs[0].url);
    var url = tabs[0].url;
    var params = window.helpers.parseUrl(url);
    if ( params.host.match(Klickr.hostname) && params.query.hasOwnProperty('url') && params.query.hasOwnProperty('id') ){
      console.log('Background: Play recording with url', decodeURIComponent(params.query.url), 'and id', params.query.id);
      chrome.tabs.update(tabs[0].id, {url: decodeURIComponent(params.query.url)});
      bgPlayer.id = params.query.id;
      bgPlayer.getKlick(bgPlayer.id);
    }
  });
});

// listener on saver box (replay, save, share) and recorder (stage)
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // in multi-page recording, used to store the next klick object that will be given after the page changes to a new url
  if (request.action === 'klickFinished') {
    bgPlayer.klickQueueIndex++;
    console.log(bgPlayer.tabId);
    if (bgPlayer.klickQueueIndex < bgPlayer.klickQueue.length){
      bgPlayer.stagedKlick = bgPlayer.klickQueue[bgPlayer.klickQueueIndex];
      bgPlayer.redirect(bgPlayer.stagedKlick.ticks[0].url);
      chrome.tabs.query({}, function(tabs){
        var foundTab;
        for(var i = 0; i < tabs.length; i++){
          if(tabs[i].id === bgPlayer.tabId){
            foundTab = tabs[i];
            break;
          }
        }
        if(foundTab.status === 'complete'){
          console.log('status complete');
          chrome.tabs.sendMessage(bgPlayer.tabId, {action:'play', klick: bgPlayer.stagedKlick});
          bgPlayer.stagedKlick = undefined;
        } else{
          console.log('i hate you');
          //return;
        }
      });
      console.log('Background: Store recording in background');
      sendResponse({response: "Background: Processed storage message"});
    }
    else {
      console.log("Play Finished");
      this.klickQueue = [];
      this.klickQueueIndex = -1;
      sendResponse({response: "Background: Finished klick play"});
    }
  }

  else if (request.action === 'klickPaused') {
    var rawKlickIndex = bgPlayer.getRawKlickIndex(bgPlayer.klickQueueIndex, request.index);
    chrome.runtime.sendMessage({action:'pauseIndex', index: rawKlickIndex});
  }

  // if the dom is ready and nextKlick is not false, then send the current page a new klick object to restart the player.
  else if (request.action === 'playerReady' && !!bgPlayer.stagedKlick && sender.tab.id === bgPlayer.tabId) {
    chrome.tabs.sendMessage(bgPlayer.tabId, {action:'play', klick: bgPlayer.stagedKlick});
    sendResponse({response: "Background: Processed klickFinished message"});
    bgPlayer.stagedKlick = undefined;
  }

});
