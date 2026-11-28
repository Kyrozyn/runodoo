package system

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/runodoo/runodoo/internal/models"
)

// RunDiskBenchmark measures sequential read/write MB/s and random 4K read/write IOPS on dataDir.
func RunDiskBenchmark(dataDir string) (*models.DiskBenchmark, error) {
	benchFile := filepath.Join(dataDir, fmt.Sprintf(".runodoo-bench-%d.tmp", time.Now().UnixNano()))
	defer os.Remove(benchFile)

	const totalMB = 32
	const blockSize = 1024 * 1024 // 1 MB
	const ioSize = 4096           // 4 KB

	buf := make([]byte, blockSize)
	_, _ = rand.Read(buf)

	// 1. Sequential Write MB/s (flushed to disk)
	wf, err := os.OpenFile(benchFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed creating benchmark file: %w", err)
	}
	wStart := time.Now()
	for i := 0; i < totalMB; i++ {
		if _, err := wf.Write(buf); err != nil {
			wf.Close()
			return nil, fmt.Errorf("benchmark write failed: %w", err)
		}
	}
	_ = wf.Sync()
	wElapsed := time.Since(wStart).Seconds()
	wf.Close()
	if wElapsed <= 0 {
		wElapsed = 0.001
	}
	writeMBps := int64(float64(totalMB) / wElapsed)
	if writeMBps < 1 {
		writeMBps = 1
	}

	// 2. Sequential Read MB/s (attempt O_DIRECT to bypass OS page cache)
	rf, err := os.OpenFile(benchFile, os.O_RDONLY|syscall.O_DIRECT, 0)
	if err != nil {
		rf, err = os.Open(benchFile)
		if err != nil {
			return nil, fmt.Errorf("benchmark read open failed: %w", err)
		}
	}
	readBuf := make([]byte, blockSize)
	rStart := time.Now()
	for i := 0; i < totalMB; i++ {
		if _, err := rf.Read(readBuf); err != nil {
			break
		}
	}
	rElapsed := time.Since(rStart).Seconds()
	rf.Close()
	if rElapsed <= 0 {
		rElapsed = 0.001
	}
	readMBps := int64(float64(totalMB) / rElapsed)
	if readMBps < 1 {
		readMBps = 1
	}

	maxSlots := int64((totalMB * blockSize) / ioSize)
	ioBuf := make([]byte, ioSize)
	copy(ioBuf, buf[:ioSize])

	// 3. Random 4KB Write IOPS (O_SYNC, bounded to 750ms or 1000 ops)
	rwf, err := os.OpenFile(benchFile, os.O_RDWR|os.O_SYNC, 0)
	if err != nil {
		return nil, fmt.Errorf("benchmark random write open failed: %w", err)
	}
	var wOps int64
	rwStart := time.Now()
	for wOps < 1000 && time.Since(rwStart) < 750*time.Millisecond {
		slot, _ := rand.Int(rand.Reader, big.NewInt(maxSlots))
		if _, err := rwf.WriteAt(ioBuf, slot.Int64()*ioSize); err != nil {
			break
		}
		wOps++
	}
	rwElapsed := time.Since(rwStart).Seconds()
	rwf.Close()
	if rwElapsed <= 0 {
		rwElapsed = 0.001
	}
	writeIOPS := int64(float64(wOps) / rwElapsed)
	if writeIOPS < 10 {
		writeIOPS = 10
	}

	// 4. Random 4KB Read IOPS (attempt O_DIRECT, bounded to 750ms or 5000 ops)
	rrf, err := os.OpenFile(benchFile, os.O_RDONLY|syscall.O_DIRECT, 0)
	if err != nil {
		rrf, err = os.Open(benchFile)
		if err != nil {
			return nil, fmt.Errorf("benchmark random read open failed: %w", err)
		}
	}
	var rOps int64
	rrStart := time.Now()
	for rOps < 5000 && time.Since(rrStart) < 750*time.Millisecond {
		slot, _ := rand.Int(rand.Reader, big.NewInt(maxSlots))
		if _, err := rrf.ReadAt(ioBuf, slot.Int64()*ioSize); err != nil {
			break
		}
		rOps++
	}
	rrElapsed := time.Since(rrStart).Seconds()
	rrf.Close()
	if rrElapsed <= 0 {
		rrElapsed = 0.001
	}
	readIOPS := int64(float64(rOps) / rrElapsed)
	if readIOPS < 10 {
		readIOPS = 10
	}

	return &models.DiskBenchmark{
		ReadIOPS:      readIOPS,
		WriteIOPS:     writeIOPS,
		ReadMBps:      readMBps,
		WriteMBps:     writeMBps,
		BlockDevice:   DetectBlockDevice(dataDir),
		BenchmarkedAt: time.Now(),
	}, nil
}
