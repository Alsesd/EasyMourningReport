package web

import (
	"errors"
	"math"
)

// A deliberately small CBOR reader: WebAuthn needs integers, byte and text strings, arrays, maps and the
// simple values from attestation objects and COSE keys, nothing else (no tags, floats or indefinite lengths).

var errCBOR = errors.New("invalid CBOR")

type cborReader struct {
	b []byte
	i int
}

// decodeCBOR reads one item from b and returns it with the number of bytes it used.
// Values: int64, []byte, string, []any, map[any]any (keys int64 or string), bool, nil.
func decodeCBOR(b []byte) (any, int, error) {
	r := &cborReader{b: b}
	v, err := r.item(0)
	return v, r.i, err
}

func (r *cborReader) take(n uint64) ([]byte, error) {
	if n > uint64(len(r.b)-r.i) {
		return nil, errCBOR
	}
	out := r.b[r.i : r.i+int(n)]
	r.i += int(n)
	return out, nil
}

func (r *cborReader) item(depth int) (any, error) {
	if depth > 8 || r.i >= len(r.b) {
		return nil, errCBOR
	}
	head := r.b[r.i]
	r.i++
	major, info := head>>5, head&0x1f
	var arg uint64
	switch {
	case info < 24:
		arg = uint64(info)
	case info >= 24 && info <= 27:
		raw, err := r.take(1 << (info - 24))
		if err != nil {
			return nil, err
		}
		for _, c := range raw {
			arg = arg<<8 | uint64(c)
		}
	default:
		return nil, errCBOR
	}
	switch major {
	case 0:
		if arg > math.MaxInt64 {
			return nil, errCBOR
		}
		return int64(arg), nil
	case 1:
		if arg > math.MaxInt64 {
			return nil, errCBOR
		}
		return -1 - int64(arg), nil
	case 2, 3:
		raw, err := r.take(arg)
		if err != nil {
			return nil, err
		}
		if major == 3 {
			return string(raw), nil
		}
		return append([]byte(nil), raw...), nil
	case 4:
		if arg > uint64(len(r.b)-r.i) {
			return nil, errCBOR
		}
		out := make([]any, 0, arg)
		for n := uint64(0); n < arg; n++ {
			v, err := r.item(depth + 1)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case 5:
		if arg > uint64(len(r.b)-r.i) {
			return nil, errCBOR
		}
		out := make(map[any]any, arg)
		for n := uint64(0); n < arg; n++ {
			k, err := r.item(depth + 1)
			if err != nil {
				return nil, err
			}
			switch k.(type) {
			case int64, string:
			default:
				return nil, errCBOR
			}
			v, err := r.item(depth + 1)
			if err != nil {
				return nil, err
			}
			out[k] = v
		}
		return out, nil
	case 7:
		switch info {
		case 20:
			return false, nil
		case 21:
			return true, nil
		case 22:
			return nil, nil
		}
	}
	return nil, errCBOR
}
