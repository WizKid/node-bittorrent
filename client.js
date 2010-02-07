var posix = require("posix");
var sys = require("sys");
var tcp = require("tcp");

// 217.213.5.90:80

function bind(scope, func) {
    var _function = func;
    return function() {
        return _function.apply(scope, arguments);
    }
}


var global_fd = null;
var server_peer_id = "-NJ0001-";
while (server_peer_id.length < 20)
    server_peer_id += String.fromCharCode(Math.random()*256);

function Peer(socket, manager) {
    this.socket = socket;
    this.manager = manager;

    this.inHandshake = true;
    this.info_hash = null;
    this.peer_id = null;
    this.buffer = "";
    this.queue = [];
    this.drained = true;

    this.socket.setEncoding("binary");
    // this.socket.addListener("connect", this.onConnect);
    this.socket.addListener("receive", bind(this, this.onReceive));
    this.socket.addListener("eof", bind(this, this.onEof));
    this.socket.addListener("drain", bind(this, this.onDrain));
}

Peer.prototype = {
    // onConnect: function() {},
    readInt: function(data, offset) {
        return (data.charCodeAt(offset + 0) << 24) +
               (data.charCodeAt(offset + 1) << 16) +
               (data.charCodeAt(offset + 2) << 8) +
               (data.charCodeAt(offset + 3));
    },
    writeInt: function(data) {
        return String.fromCharCode((data >> 24) & 0xff) +
               String.fromCharCode((data >> 16) & 0xff) +
               String.fromCharCode((data >> 8) & 0xff) +
               String.fromCharCode((data) & 0xff);
    },
    handleHandshake: function(data) {
        this.inHandshake = false;

        if (data.substr(0, 20) != "\x13BitTorrent protocol") {
            sys.puts("WRONG HEADER!");
            this.socket.close();
            // this.manager.remove(this);
            return;
        }

        this.info_hash = data.substr(28, 20);
        this.peer_id = data.substr(48, 20);

        // Say hi
        var response = "\x13BitTorrent protocol\x00\x00\x00\x00\x00\x00\x00\x00"+ this.info_hash + server_peer_id;
        this.socket.send(response);

        // Tell the peer that we have all pieces
        var bitfield = "";
        var i = 0;
        var pieces = 963;
        for (; i < Math.floor(pieces / 8); i++)
            bitfield += "\xff";
        var left = pieces % 8;
        var lastbyte = 0;
        for (var j = 0; j < left; j++)
            lastbyte = (lastbyte << 1) + 1;
        lastbyte = lastbyte << 8 - left;
        bitfield += String.fromCharCode(lastbyte);
        response = this.writeInt(1 + bitfield.length) +"\x05"+ bitfield;
        for (var j = 0; j < response.length; j++)
            sys.puts(j +": "+ response.charCodeAt(j));
        this.socket.send(response);
        
        // Unchoke the peer
        this.socket.send("\x00\x00\x00\x01\x01");
    },
    handleData: function(data) {
        sys.puts("Handle data: "+ data.length);
        this.buffer += data;
        if (this.buffer.length < 4) {
            sys.puts("Buffer: "+ this.buffer.length);
            return;
        }

        var len = this.readInt(this.buffer, 0);
        sys.puts("Length: "+ len);
        if (len != 0) {
            switch (this.buffer[4]) {
                case "\x00":
                    // choke
                    sys.puts("choke");
                    break;
                case "\x01":
                    // unchoke
                    sys.puts("unchoke");
                    break;
                case "\x02":
                    // interested
                    sys.puts("interested");
                    break;
                case "\x03":
                    // not interested
                    sys.puts("not interested");
                    break;
                case "\x04":
                    // have
                    sys.puts("have");
                    break;
                case "\x05":
                    // bitfield
                    sys.puts("bitfield");
                    break;
                case "\x06":
                    // request
                    var index = this.readInt(this.buffer, 5);
                    var begin = this.readInt(this.buffer, 9);
                    var length = this.readInt(this.buffer, 13);
                    sys.puts("request "+ index +", "+ begin +", "+ length);
                    this.queue.push([index, begin, length]);
                    this.handleRequest();
                    break;
                case "\x07":
                    // piece
                    sys.puts("piece");
                    break;
                case "\x08":
                    // cancel
                    sys.puts("cancel");
                    break;
                case "\x09":
                    // port
                    sys.puts("port");
                    break;
                default:
                    sys.puts("Unknown message: "+ this.buffer.charCodeAt(4));
                    break;
            }
        }

        if (this.buffer.length == len + 4) {
            this.buffer = "";
        } else {
            this.buffer = this.buffer.substr(4 + len);
            this.handleData("");
        }
    },
    handleRequest: function() {
        if (this.queue.length == 0) // || !this.drained
            return;

        this.drained = false;
        var self = this;
        var request = this.queue.shift();
        sys.puts("handleRequest: "+ request[0] +", "+ request[1] +", "+ request[2]);
        posix.read(global_fd, request[2], request[0] * 65536 + request[1]).addCallback(function (data) {
            sys.puts("sendData: "+ request[0] +", "+ request[1] +", "+ request[2]);
            self.socket.send(self.writeInt(9 + data.length) +"\x07"+ self.writeInt(request[0]) + self.writeInt(request[1]) + data);
        });
    },
    onReceive: function(data) {
        sys.puts("RECEIVE");
        if (this.inHandshake) {
            this.handleHandshake(data);
        } else {
            this.handleData(data);
        }
    },
    onEof: function() {
        sys.puts("EOF");
        this.socket.close();
    },
    onDrain: function() {
        sys.puts("DRAIN");
        this.drained = true;
        this.handleRequest();
    }
}

var peers = [];

var server = tcp.createServer(function (socket) {
    var peer = new Peer(socket);
    peers.push(peer);
});

posix.open("test.mkv", process.O_RDONLY, 0666).addCallback(function (fd) {
    global_fd = fd;
    server.listen(80, "217.213.5.90");
});

