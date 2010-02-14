var posix = require("posix");
var events = require("events");
var bencode = require("../../bencode/lib/bencode");

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
        posix.stat(this.path).addCallback(function(stat) {
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
            posix.open(this.path, process.O_RDONLY, 0666).addCallback(function(fp) {
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
            posix.read(fp, length, begin, "binary").addCallback(function(data) {
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
}

Torrent.prototype = {
    load: function() {
        // Load the torrent file and check the data in it
        var promise = new events.Promise();
        var self = this;
        posix.cat(this.torrentpath).addCallback(function(content) {
            self._load(bencode.decode(content), promise);
        });
        return promise;
    },
    _load: function(torrentObj, promise) {
        this.pieceLength = torrentObj.info['piece length'];
        this.pieces = torrentObj.info['pieces'].length / 20;

        // Check if it is multi file mode
        if (torrentObj.files != undefined) {
            for (var i in torrentObj.files) {
                var file = torrentObj.files[i];
                this.files.append(new File(this.rootPath +"/"+ file.path.join("/"), file.length));
            }
        } else {
            this.files.append(new File(this.rootPath +"/"+ file.name, file.length));
        }

        // Should verify that the file exists and have the right amount
        // of bytes. Maybe even check pieces sha1
        // Use File.check()
        promise.emitSuccess();
    },
    request: function(index, begin, length) {
        for (var i in this.files) {
            var file = this.files[i];
            if (file.bytes > index.index * this.pieceLength + begin) {
                // Now we know the first file that we should get data from.
            }
        }
    }
}
