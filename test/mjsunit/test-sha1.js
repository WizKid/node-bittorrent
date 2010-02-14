var assert = require("assert");
var sha1 = require("./../../lib/sha1");

[
    [
        "hej",
        "\xc4\x12\xb3\x7f\x8c\x04\x84\xe6\xdb\x8b\xce\x17\x7a\xe8\x8c\x54\x43\xb2\x6e\x92"
    ],
    [
        "\x00",
        "\x5b\xa9\x3c\x9d\xb0\xcf\xf9\x3f\x52\xb5\x21\xd7\x42\x0e\x43\xf6\xed\xa2\x78\x4f"
    ],
    [
        "",
        "\xda\x39\xa3\xee\x5e\x6b\x4b\x0d\x32\x55\xbf\xef\x95\x60\x18\x90\xaf\xd8\x07\x09"
    ],
    [
        "This is a long sentence. ajsda9d sd0asd0 asd k3d 94r 9sjfsd fjsldf s.d,f ,sdfsmdf0sdfs-df-sd.f,sd9fsd9f sfdsfsdfsdkf9sdf hs8fh 4 rsa 90 a 8 38u f9sjdf9sdf9sdfjsd9pfj9sdfj",
        "\xf9\x1f\x61\x14\x28\xfe\x62\x35\x70\x5a\xb6\x27\xbf\x47\xec\x61\x21\x74\xfb\xa6"
    ],
].forEach(function(comp) {
    assert.equal(comp[1], sha1.hash(comp[0]));
});