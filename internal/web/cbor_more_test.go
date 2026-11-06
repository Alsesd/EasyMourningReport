package web

import (
	"bytes"
	"testing"
)

func TestCBORDecodesEveryKindWeUse(t *testing.T) {
	cases := []struct {
		in   []byte
		want any
	}{
		{[]byte{0x05}, int64(5)},
		{[]byte{0x18, 0x64}, int64(100)},
		{[]byte{0x19, 0x01, 0x00}, int64(256)},
		{[]byte{0x20}, int64(-1)},
		{[]byte{0x38, 0x63}, int64(-100)},
		{[]byte{0x42, 1, 2}, []byte{1, 2}},
		{[]byte{0x62, 'h', 'i'}, "hi"},
		{[]byte{0xf4}, false},
		{[]byte{0xf5}, true},
		{[]byte{0xf6}, nil},
	}
	for _, c := range cases {
		got, n, err := decodeCBOR(c.in)
		if err != nil || n != len(c.in) {
			t.Fatalf("% x: %v n=%d", c.in, err, n)
		}
		if b, ok := c.want.([]byte); ok {
			if !bytes.Equal(got.([]byte), b) {
				t.Fatalf("% x: %v", c.in, got)
			}
		} else if got != c.want {
			t.Fatalf("% x: %v, want %v", c.in, got, c.want)
		}
	}
	arr, _, err := decodeCBOR([]byte{0x82, 0x01, 0x62, 'a', 'b'})
	if l, ok := arr.([]any); err != nil || !ok || len(l) != 2 || l[0] != int64(1) || l[1] != "ab" {
		t.Fatalf("array: %v %v", arr, err)
	}
	m, _, err := decodeCBOR([]byte{0xa2, 0x01, 0x02, 0x61, 'k', 0x03})
	if mm, ok := m.(map[any]any); err != nil || !ok || mm[int64(1)] != int64(2) || mm["k"] != int64(3) {
		t.Fatalf("map: %v %v", m, err)
	}
}

func TestCBORRejectsWhatItDoesNotUnderstand(t *testing.T) {
	for name, in := range map[string][]byte{
		"huge uint":       {0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff},
		"huge negative":   {0x3b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff},
		"truncated array": {0x82, 0x01},
		"truncated map":   {0xa1, 0x01},
		"array too long":  {0x9a, 0xff, 0xff, 0xff, 0xff},
		"map too long":    {0xba, 0xff, 0xff, 0xff, 0xff},
		"bad map key":     {0xa1, 0x42, 1, 2, 0x01},
		"missing value":   {0xa1, 0x01},
		"tag":             {0xc1, 0x01},
		"float":           {0xf9, 0x00, 0x00},
		"indefinite":      {0x9f},
		"too deep":        {0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x01},
	} {
		if _, _, err := decodeCBOR(in); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
