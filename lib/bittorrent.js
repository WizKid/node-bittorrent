var events = require("events");
var fs = require("fs");
var net = require("net");

var bencode = require("./bencode");
var sys = require("sys");
var crypto = require("crypto");

function equalBuffer(b1, b2) {
    if (b1.length != b2.length)
        return false;

    for (var i = 0; i < b1.length; i++) {
        if (b1[i] != b2[i])
            return false;
    }
    return true;
}

function bufferToHex(str) {
    var ret = "";
    for (var i = 0; i < str.length; i++) {
        var l = str[i].toString(16);
        if (l.length == 1)
            ret += "0" + l;
        else
            ret += l;
    }
    return ret;
}


function bind(scope, func) {
    var _function = func;
    return function() {
        return _function.apply(scope, arguments);
    }
}

function Request(index, begin, length) {
    this.index = index;
    this.begin = begin;
    this.length = length;
}

function Client() {
    this.torrents = {};
    this.peers = [];

    this.peerId = new Buffer(20);
    this.peerId.write("-NJ0001-", 0, "ascii");
    while (this.peerId.length < 20)
    for (var i = 8; i < 20; i++)
        this.peerId[i] += Math.floor(Math.random() * 256);

    var self = this;
    this.server = net.createServer(function(stream) {
        sys.puts("Client connected");
        self.addPeer(stream);
    });
}

Client.prototype = {
    addPeer: function(stream) {
        this.peers.push(new Peer(stream, this));
    },
    removePeer: function(peer) {
        sys.puts("Remove peer from this.peers");
    },
    listen: function(port, ip) {
        this.server.listen(port, ip || "localhost");
    },
    addTorrent: function(torrent) {
        this.torrents[torrent.infoHash] = torrent;
    },
    hasTorrent: function(infoHash) {
        return this.torrents[infoHash] != undefined;
    },
    getTorrent: function(infoHash) {
        if (!this.hasTorrent(infoHash))
            return null;

        return this.torrents[infoHash];
    }
}

const BITTORRENT_HEADER = new Buffer("\x13BitTorrent protocol\x00\x00\x00\x00\x00\x00\x00\x00", "binary");

function Peer(stream, client) {
    this.stream = stream;
    this.client = client;

    this.inHandshake = true;
    this.infoHash = null;
    this.peerId = null;
    this.buffer = [];
    this.queue = [];
    this.drained = true;

    var self = this;
    this.stream.on("connect", function() { self.onConnect(); });
    this.stream.on("data", function(data) { self.onData(data); });
    this.stream.on("end", function() { self.onEnd(); });
    this.stream.on("drain", function() { self.onDrain(); });
}

Peer.prototype = {
    onConnect: function() {
        sys.puts("CONNECT!");
    },
    readInt: function(data, offset) {
        return (data[offset + 0] << 24) +
               (data[offset + 1] << 16) +
               (data[offset + 2] << 8) +
               (data[offset + 3]);
    },
    writeInt: function(data) {
        return String.fromCharCode((data >> 24) & 0xff) +
               String.fromCharCode((data >> 16) & 0xff) +
               String.fromCharCode((data >> 8) & 0xff) +
               String.fromCharCode((data) & 0xff);
    },
    disconnect: function(msg) {
        sys.puts("Disconnect: "+ msg);
        this.stream.close();
        this.client.removePeer(this);
    },
    messageHeader: function(type, length) {
        var header = new Buffer(5);
        header[0] = (length >> 24) & 0xff;
        header[1] = (length >> 16) & 0xff;
        header[2] = (length >> 8) & 0xff;
        header[3] = (length) & 0xff;
        header[4] = type;
        return header;
    },
    handleHandshake: function(data) {
        this.inHandshake = false;

        if (data == null || data.length < 48 || !equalBuffer(data.slice(0, 20), BITTORRENT_HEADER.slice(0, 20))) {
            this.disconnect("Strange handshake: "+ data);
            return null;
        }

        this.infoHash = data.slice(28, 48);
        sys.puts("InfoHash: "+ bufferToHex(this.infoHash) +" ("+ this.infoHash.length +")");
        if (!this.client.hasTorrent(this.infoHash)) {
            this.disconnect("Torrent don't exists: "+ this.infoHash);
            return null;
        }

        // Say hi
        this.stream.write(BITTORRENT_HEADER);
        this.stream.write(this.infoHash);
        this.stream.write(this.client.peerId);

        if (data.length < 68) {
            this.disconnect("No peerId so this was probably a tracker checking in");
            return null;
        }

        this.peerId = data.toString(encoding="binary", 48, 68);

        // Get the torrent
        var torrent = this.client.getTorrent(this.infoHash);

        // Tell the peer that we have all pieces
        var bitfieldLength = Math.ceil(torrent.pieces / 8);
        var bitfield = new Buffer(bitfieldLength);
        for (var i = 0; i < bitfieldLength; i++)
            bitfield[i] == 0xff;

        this.stream.write(this.messageHeader(5, bitfieldLength + 1));
        this.stream.write(bitfield);

        // Unchoke the peer
        this.stream.write(this.messageHeader(1, 1));

        if (data.length > 68)
            return data.slice(68);

        return null;
    },
    onData: function(data) {
        sys.puts("onData");
        if (this.inHandshake)
            data = this.handleHandshake(data);

        sys.puts("Handle data: "+ ((data == null) ? "null" : data.length));
        if (data != null) {
            if (this.buffer != null) {
                // resize buffer and copy data into it
                var tmpBuffer = new Buffer(this.buffer.length + data.length);
                this.buffer.copy(tmpBuffer, 0, 0);
                data.copy(tmpBuffer, this.buffer.length, 0);
                this.buffer = tmpBuffer;
            } else {
                this.buffer = data;
            }
        }

        if (this.buffer == null || this.buffer.length < 4) {
            sys.puts("Buffer: "+ ((this.buffer == null) ? "null" : this.buffer.length));
            return;
        }

        var len = this.readInt(this.buffer, 0);

        // Check if the buffer contains all data we need
        if (this.buffer.length < 4 + len)
            return;

        sys.puts("Length: "+ len);
        if (len != 0) {
            switch (this.buffer[4]) {
                case 0:
                    // choke
                    sys.puts("choke");
                    break;
                case 1:
                    // unchoke
                    sys.puts("unchoke");
                    break;
                case 2:
                    // interested
                    sys.puts("interested");
                    break;
                case 3:
                    // not interested
                    sys.puts("not interested");
                    break;
                case 4:
                    // have
                    sys.puts("have");
                    break;
                case 5:
                    // bitfield
                    sys.puts("bitfield");
                    break;
                case 6:
                    // request
                    sys.puts("request");
                    this.queue.push(new Request(this.readInt(this.buffer, 5), this.readInt(this.buffer, 9), this.readInt(this.buffer, 13)));
                    this.handleRequest();
                    break;
                case 7:
                    // piece
                    sys.puts("piece");
                    break;
                case 8:
                    // cancel
                    sys.puts("cancel");
                    break;
                case 9:
                    // port
                    sys.puts("port");
                    break;
                default:
                    this.disconnect("Unknown message: "+ this.buffer[4]);
                    break;
            }
        }

        if (this.buffer.length == len + 4) {
            this.buffer = null;
        } else {
            this.buffer = this.buffer.slice(len + 4, this.buffer.length);
            this.onData(null);
        }
    },
    handleRequest: function() {
        sys.puts("handleRequest: "+ this.queue.length +", "+ this.drained);
        if (this.queue.length == 0) // || !this.drained)
            return;

        var request = this.queue.shift();

        sys.puts("handleRequest: "+ request.index +", "+ request.begin +", "+ request.length);

        var torrent = this.client.getTorrent(this.infoHash);
        var self = this;
        torrent.read(request.index, request.begin, request.length, function(err, data) {
            if (err) {
                sys.puts("ERROR: "+ err);
                return;
            }

            self.drained = !self.stream.write(self.writeInt(9 + request.length) +"\x07"+ self.writeInt(request.index) + self.writeInt(request.begin) + data);
            sys.puts("Drained: "+ self.drained);
            self.handleRequest();
        });
    },
    onEnd: function() {
        sys.puts("END");
        this.disconnect("Connection closed");
    },
    onDrain: function() {
        sys.puts("DRAIN: "+ this.stream.readyState);
        this.drained = true;
        this.handleRequest();
    }
}

function File(path, bytes) {
    this.path = path;
    this.bytes = bytes;
    this.fp = null;
    this.next = null;
}

File.prototype = {
    check: function(callback) {
        fs.stat(this.path, function(err, stat) {
            if (err) {
                callback(err);
                return;
            }

            if (stat.size == this.bytes)
                callback(null);
            else
                callback("File size differs from what it should be");
        });
    },
    getFp: function(callback) {
        if (this.fp) {
            callback(null, this.fp);
        } else {
            var self = this;
            sys.puts("getFp: "+ this.path);
            fs.open(this.path, process.O_RDONLY, 0666, function(err, fp) {
                if (err) {
                    callback(err);
                    return;
                }

                self.fp = fp;
                callback(null, fp);
            });
        }
    },
    read: function(start, length, nextData, callback) {
        sys.puts("File.read: "+ start +", "+ length);

        if (start + length > this.bytes) {
            sys.puts("Call next file");
            var self = this;
            function callback2(err, data) {
                if (err) {
                    callback(err);
                    return;
                }

                self.read(start, self.bytes - start, data, callback);
            }

            this.next.read(0, start + length - this.bytes, "", callback2);
            return;
        }

        this.getFp(function(err, fp) {
            if (err) {
                callback(err);
                return;
            }

            fs.read(fp, length, start, "binary", function(err, data) {
                if (err) {
                    callback(err);
                    return;
                }

                callback(null, data + nextData);
            });
        });
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
    load: function(callback) {
        // Load the torrent file and check the data in it
        var self = this;
        fs.readFile(this.torrentPath, "binary", function(err, data) {
            if (err) {
                callback(err);
                return;
            }

            var torrentObj;
            try {
                torrentObj = bencode.decode(data);
            } catch (err) {
                callback(err);
                return;
            }

            self.loadData(torrentObj, callback);
        });
    },
    loadData: function(torrentObj, callback) {
        var info = torrentObj.info;
        this.infoHash = new Buffer(crypto.createHash("sha1").update(bencode.encode(info)).digest(), "binary");
        sys.puts("infoHash: "+ bufferToHex(this.infoHash));
        this.pieceLength = info['piece length'];
        this.pieces = info['pieces'].length / 20;

        // Check if it is multi file mode
        if (info.files != undefined) {
            var lastFile = null;
            for (var i in info.files) {
                var f = info.files[i];
                var file = new File(this.rootPath +"/"+ f.path.join("/"), f.length);
                this.files.push(file);

                // Each file have reference to the next file. So when pieces
                // stretches over several files the first file that is called
                // can call the next file for data.
                if (lastFile != null)
                    lastFile.next = file;
                lastFile = file;
            }
        } else {
            this.files.push(new File(this.rootPath +"/"+ info.name, info.length));
        }

        // Should verify that the file exists and have the right amount
        // of bytes. Maybe even check pieces sha1
        // Use File.check() for size check
        callback(null);
    },
    read: function(index, begin, length, callback) {
        sys.puts("Torrent.read: "+ index +", "+ begin +", "+ length);
        var start = index * this.pieceLength + begin;
        var startByte = 0;
        for (var i = 0; i < this.files.length; i++) {
            var file = this.files[i];
            if (startByte + file.bytes > start) {
                file.read(start - startByte, length, "", callback);
                return;
            }
            startByte += file.bytes;
        }

        callback("Couldn't find any file to read");
    }
}

exports.Torrent = Torrent;
exports.Client = Client;
