var fs = require("fs");
var events = require("events");
var bencode = require("../../bencode/lib/bencode");
var sha1 = require("./sha1");
var sys = require("sys");

function Client() {
}

Client.prototype = {
    addTorrent: function(torrent) {
        
    }
}

function File(path, bytes) {
    this.path = path;
    this.bytes = bytes;
    this.fp = null;
}

File.prototype = {
    check: function() {
        var promise = new events.Promise();
        fs.stat(this.path).addCallback(function(stat) {
            if (stat.size == this.bytes)
                promise.emitSuccess();
            else
                promise.emitError();
        }).addErrback(function() {
            promise.emitError();
        });
        return promise;
    },
    getFp: function() {
        var promise = events.Promise();
        if (this.fp) {
            promise.emitSuccess(this.fp);
        } else {
            var self = this;
            fs.open(this.path, process.O_RDONLY, 0666).addCallback(function(fp) {
                self.fp = fp;
                promise.emitSuccess(fp);
            }).addErrback(function() {
                promise.emitError();
            });
        }

        return promise;
    },
    read: function(begin, length) {
        var promise = new events.Promise();
        this.getFp().addCallback(function(fp) {
            fs.read(fp, length, begin, "binary").addCallback(function(data) {
                promise.emitSuccess(data);
            });
        });
        return promise;
    }
}

function Torrent(torrentPath, rootPath) {
    this.torrentPath = torrentPath;
    this.rootPath = rootPath;
    this.files = [];
    this.pieceLength = 0;
    this.pieces = 0;
    this.infoHash = null;
}

Torrent.prototype = {
    load: function() {
        // Load the torrent file and check the data in it
        var promise = new events.Promise();
        var self = this;
        fs.cat(this.torrentPath, "binary").addCallback(function(content) {
            self.loadData(bencode.decode(content), promise);
        });
        return promise;
    },
    loadData: function(torrentObj, promise) {
        var info = torrentObj.info;
        this.infoHash = sha1.hash(bencode.encode(info));
        this.pieceLength = info['piece length'];
        this.pieces = info['pieces'].length / 20;

        // Check if it is multi file mode
        if (info.files != undefined) {
            for (var i in info.files) {
                var file = info.files[i];
                this.files.push(new File(this.rootPath +"/"+ file.path.join("/"), file.length));
            }
        } else {
            this.files.push(new File(this.rootPath +"/"+ info.name, info.length));
        }

        // Should verify that the file exists and have the right amount
        // of bytes. Maybe even check pieces sha1
        // Use File.check() for size check
        promise.emitSuccess();
    },
    request: function(index, begin, length) {
        var startbyte = 0;
        for (var i in this.files) {
            var file = this.files[i];
            if (startbyte + file.bytes > index.index * this.pieceLength + begin) {
                // Now we know the first file that we should get data from.
                // If the torrent have several files we need to handle pieces that
                // stretches over several files
                return file.read(index.index * this.pieceLength - startbyte, length);
            }
            startbyte += file.bytes;
        }

        return null;
    }
}

exports.Torrent = Torrent;