var util = require('util');
var BaseRole = require('./base-role');

function Leader(raftState, clusterConfig, requestService) {
    var self = this;
    BaseRole.call(self, raftState, clusterConfig);

    self._requestService = requestService;
    self._callbacks = {};
}

util.inherits(Leader, BaseRole);

Leader.prototype.start = function () {
    var self = this;

    function sendAppendEntries(id) {
        var msg = self._raftState.createAppendEntriesMsg(id);
        self._requestService.send('append-entries', id, msg, function (err, result) {
            if (!err) {
                self._handler.checkTerm(result.term, function () {
                    resultHandler(id, msg.entries.length, result);
                });
            }
        });
    }

    function resultHandler(id, entriesCount, result) {
        if (result.success) {
            self._handler.updateFollowerIndex(id, entriesCount, function retry(id) {
                sendAppendEntries(id);
            });

            var majority = self._raftState.getMajority();
            self._handler.updateCommitIndex(majority, function (err, result) {
                var callback = self._callbacks[self._raftState.lastApplied];
                delete self._callbacks[self._raftState.lastApplied];

                callback(err, {isLeader: true, value: result});
            });
        } else {
            self._handler.decFollowerIndex(id, function retry(id) {
                sendAppendEntries(id);
            });
        }
    }

    self._raftState.initializeIndex();
    self._requestService.start(sendAppendEntries);
    self._clusterConfig.forEach(function (nodeInfo) {
        sendAppendEntries(nodeInfo.id);
    });
};

Leader.prototype.stop = function () {
    var self = this;
    self._requestService.stop();
    self._callbacks = {};
};

Leader.prototype.exec = function (cmd, callback) {
    var self = this;
    self._raftState.addCmd(cmd);
    self._callbacks[self.lastLogIndex] = callback;
};


// *************************
var ELECTION_TIMEOUT = 300;
var ROUND_COUNT = 10;

Leader.prototype.addServer = function (nodeAddress, callback) {
    var self = this;
    // TODO: raftState.nextIndex[id] -> new server OR local nextIndex ???

    var node = {nextIndex: self._raftState.lastLogIndex, matchIndex: 0};

    var request = new Request(nodeAddress.host, nodeAddress.port, 300);
    request.start();

    var count = ROUND_COUNT;

    round(checkRound);

    function checkRound(time) {
        if (time > ELECTION_TIMEOUT && count > 0) {
            count--;
            round(checkRound);
        } else if (time < ELECTION_TIMEOUT && count > 0) {
            waitPrevCommit(function(){
                addConfig(nodeAddress);
            });
        } else {
            callback(null, {status: 'TIMEOUT'});
        }
    }

    function addConfig(nodeAddress) {
        var cmd = {value: nodeAddress, type: 'cluster'};
        self._raftState.addCmd(cmd);
    }

    function round(finishRound) {
        var start = Date.now();
        var lastRoundIndex = self._raftState.lastLogIndex;
        catchUp(lastRoundIndex, function () {
            var finish = Date.now();
            finishRound(finish - start);
        });

    }

    function catchUp(lastRoundIndex, finishCallback) {
        // Msg with batch entries
        var msg = self._raftState.createAppendEntriesMsg(lastRoundIndex, node.matchIndex);
        request.send('append-entries', msg, function (err, result) {
            if (err) {
                return callback(err);
            }

            updateIndex(result.matchIndex);
            if (result.matchIndex === lastRoundIndex) {
                return finishCallback();
            }

            catchUp(result.matchIndex, finishCallback);
        });
    }

    function updateIndex(matchIndex) {
        node.nextIndex = matchIndex + 1;
        node.matchIndex = matchIndex;
    }
};


BaseRole.prototype.removeServer = function (nodeAddress, callback) {
    var self = this;


};

module.exports = Leader;