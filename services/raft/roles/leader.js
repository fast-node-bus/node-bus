var util = require('util');
var BaseState = require('./base-state');

var HEART_BEAT_DELAY = 100;

function Leader(clusterConfig, requestService, raftState, cmdHandler) {
    var self = this;
    BaseState.call(self, raftState);

    self._clusterConfig = clusterConfig;
    self._requestService = requestService;
    self._leaderHandler = new LeaderHandler(raftState, roleManager);
    self._cmdHandler = cmdHandler;
    self._callbacks = {};

    self._clusterConfig.onAddNode(function (nodeInfo) {
        self._requestService.add(nodeInfo);
        self._raftState.addNode(nodeInfo);
    });

    self._clusterConfig.onRemoveNode(function (nodeInfo) {
        self._requestService.remove(nodeInfo.id);
        self._raftState.removeNode(nodeInfo);
    });
}

util.inherits(Leader, BaseState);

Leader.prototype.start = function () {
    var self = this;
    var nodes = self._clusterConfig.getNodes();

    // ***********************

    function sendAppendEntries(id) {
        var msg = self._raftState.createAppendEntriesMsg(id);
        self._requestService.send('append-entries', id, msg, function (err, result) {
            if (!err) {
                self._leaderHandler.checkTerm(result.term, function(){
                    resultHandler(id, result.success);
                });
            }
        });
    }

    function resultHandler(id, success) {
        if (success) {
            self._leaderHandler.updateFollowerIndex(id, function retry(id) {
                sendAppendEntries(id);
            });

            var majority = self._clusterConfig.getMajority();
            self._leaderHandler.updateCommitIndex(majority, function (err, result) {
                var callback = self._callbacks[self._raftState.lastApplied];
                delete self._callbacks[self._raftState.lastApplied];

                callback(err, result);
            });
        } else {
            self._leaderHandler.decFollowerIndex(id, function retry(id) {
                sendAppendEntries(id);
            });
        }
    }

    self._requestService.start(sendAppendEntries);
    nodes.forEach(function (nodeInfo) {
        sendAppendEntries(nodeInfo.id);
    });
};

Leader.prototype.exec = function (cmd, callback) {
    var self = this;
    self._raftState.addCmd(cmd);
    self._callbacks[self.lastLogIndex] = callback;
};

Leader.prototype.stop = function () {
    var self = this;
    self._requestService.stop();
    self._callbacks = {};
};

module.exports = Leader;