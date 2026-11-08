package reports

import "time"

// Signature is one person's mark on a day: when and who.
type Signature struct {
	ByID   int64
	ByName string
	At     time.Time
}

// Signatures of a day: the store employee who submitted it last, and the reviewer who locked it last.
type Signatures struct {
	Submitted *Signature
	Locked    *Signature
}

// Kinds of a day signature (SignDay).
const (
	KindStore = "store"
	KindAdmin = "admin"
)
