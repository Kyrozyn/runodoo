package system

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"

	"github.com/runodoo/runodoo/internal/models"
)

// CollectSystemInfo inspects host CPU, RAM, Disk, and OS (including Google COS detection).
func CollectSystemInfo(dataDir, panelPort string, dockerConnected bool, dockerVersion string) models.SystemInfo {
	hostname, _ := os.Hostname()
	osPretty, isCOS := detectOS()
	totalRAM, availRAM := detectRAM()
	diskTotal, diskFree := detectDisk(dataDir)

	cpuOK, memOK, ioOK, limitNotes := DetectCgroupCapabilities(dataDir)
	return models.SystemInfo{
		Hostname:        hostname,
		OSPretty:        osPretty,
		IsCOS:           isCOS,
		Arch:            runtime.GOARCH,
		CPUCores:        runtime.NumCPU(),
		TotalRAMMB:      totalRAM,
		AvailableRAMMB:  availRAM,
		DiskTotalGB:     diskTotal,
		DiskFreeGB:      diskFree,
		DockerConnected: dockerConnected,
		DockerVersion:   dockerVersion,
		PanelPort:       panelPort,
		BlockDevice:     DetectBlockDevice(dataDir),
		CPULimitOK:      cpuOK,
		MemoryLimitOK:   memOK,
		DiskIOLimitOK:   ioOK,
		LimitNotes:      limitNotes,
	}
}

// RecommendedOdooResources computes smart defaults matching install-odoo.sh for small VPS/e2-micro.
func RecommendedOdooResources(totalRAMMB int64, cpuCores int) models.ResourceConfig {
	if totalRAMMB > 0 && totalRAMMB <= 1500 {
		return models.ResourceConfig{
			Workers:         0,
			LimitMemorySoft: 671088640,  // 640MB
			LimitMemoryHard: 805306368,  // 768MB
			LimitTimeCPU:    36000,
			LimitTimeReal:   36000,
			MaxCronThreads:  1,
		}
	}
	workers := (cpuCores * 2) + 1
	if workers > 4 {
		workers = 4
	}
	if workers < 2 {
		workers = 2
	}
	return models.ResourceConfig{
		Workers:         workers,
		LimitMemorySoft: 805306368,  // 768MB
		LimitMemoryHard: 1073741824, // 1GB
		LimitTimeCPU:    36000,
		LimitTimeReal:   36000,
		MaxCronThreads:  1,
	}
}

// RecommendedPostgresTuningMap computes recommended PostgreSQL parameter values for host RAM.
func RecommendedPostgresTuningMap(totalRAMMB int64) map[string]string {
	if totalRAMMB <= 0 {
		totalRAMMB = 1024
	}
	sharedBuf := totalRAMMB / 4
	if sharedBuf < 128 {
		sharedBuf = 128
	}
	effCache := totalRAMMB / 2
	if effCache < 256 {
		effCache = 256
	}
	maintMem := totalRAMMB / 16
	if maintMem < 32 {
		maintMem = 32
	}
	return map[string]string{
		"shared_buffers":       strconv.FormatInt(sharedBuf, 10) + "MB",
		"effective_cache_size": strconv.FormatInt(effCache, 10) + "MB",
		"maintenance_work_mem": strconv.FormatInt(maintMem, 10) + "MB",
		"work_mem":             "4MB",
		"max_connections":      "100",
	}
}

// RecommendedPostgresTuning computes PostgreSQL flags for host RAM.
func RecommendedPostgresTuning(totalRAMMB int64) []string {
	m := RecommendedPostgresTuningMap(totalRAMMB)
	return []string{
		"postgres",
		"-c", "shared_buffers=" + m["shared_buffers"],
		"-c", "effective_cache_size=" + m["effective_cache_size"],
		"-c", "maintenance_work_mem=" + m["maintenance_work_mem"],
		"-c", "work_mem=" + m["work_mem"],
		"-c", "max_connections=" + m["max_connections"],
	}
}

func detectOS() (string, bool) {
	if runtime.GOOS != "linux" {
		return runtime.GOOS + " (" + runtime.GOARCH + ")", false
	}
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "Linux", false
	}
	defer f.Close()

	var pretty, id string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			pretty = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
		} else if strings.HasPrefix(line, "ID=") {
			id = strings.Trim(strings.TrimPrefix(line, "ID="), `"`)
		}
	}
	if pretty == "" {
		pretty = "Linux"
	}
	return pretty, strings.EqualFold(id, "cos")
}

func detectRAM() (totalMB int64, availMB int64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		valKB, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalMB = valKB / 1024
		case "MemAvailable:":
			availMB = valKB / 1024
		}
	}
	return totalMB, availMB
}

func detectDisk(path string) (totalGB float64, freeGB float64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0
	}
	total := float64(stat.Blocks) * float64(stat.Bsize) / (1024 * 1024 * 1024)
	free := float64(stat.Bavail) * float64(stat.Bsize) / (1024 * 1024 * 1024)
	return float64(int(total*10)) / 10, float64(int(free*10)) / 10
}

// DetectBlockDevice resolves the parent host block device (e.g. /dev/vda, /dev/sda, /dev/nvme0n1)
// backing targetPath by inspecting /proc/mounts.
func DetectBlockDevice(targetPath string) string {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return ""
	}
	defer f.Close()

	absTarget, err := filepath.Abs(targetPath)
	if err != nil {
		absTarget = targetPath
	}

	bestMount := ""
	bestDev := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		dev, mnt := fields[0], fields[1]
		if !strings.HasPrefix(dev, "/dev/") {
			continue
		}
		if absTarget == mnt || mnt == "/" || strings.HasPrefix(absTarget, strings.TrimSuffix(mnt, "/")+"/") {
			if len(mnt) > len(bestMount) {
				bestMount = mnt
				bestDev = dev
			}
		}
	}
	return parentBlockDevice(bestDev)
}

func parentBlockDevice(dev string) string {
	if dev == "" {
		return ""
	}
	// /dev/nvme0n1p1 -> /dev/nvme0n1, /dev/mmcblk0p1 -> /dev/mmcblk0
	if strings.Contains(dev, "nvme") || strings.Contains(dev, "mmcblk") {
		if idx := strings.LastIndexByte(dev, 'p'); idx > 0 {
			suffix := dev[idx+1:]
			if _, err := strconv.Atoi(suffix); err == nil {
				return dev[:idx]
			}
		}
		return dev
	}
	// /dev/sda1 -> /dev/sda, /dev/vda1 -> /dev/vda
	return strings.TrimRight(dev, "0123456789")
}

// DetectCgroupCapabilities checks whether the host Linux kernel exposes cpu, memory, and io/blkio cgroup controllers.
func DetectCgroupCapabilities(dataDir string) (cpuOK, memOK, ioOK bool, note string) {
	var missing []string

	// cgroup v2 unified hierarchy
	if data, err := os.ReadFile("/sys/fs/cgroup/cgroup.controllers"); err == nil {
		fields := strings.Fields(string(data))
		has := map[string]bool{}
		for _, f := range fields {
			has[f] = true
		}
		cpuOK = has["cpu"]
		memOK = has["memory"]
		ioOK = has["io"]
	} else {
		// Fallback to cgroup v1 hierarchy
		_, errCPU := os.Stat("/sys/fs/cgroup/cpu")
		_, errMem := os.Stat("/sys/fs/cgroup/memory")
		_, errBlk := os.Stat("/sys/fs/cgroup/blkio")
		cpuOK = errCPU == nil
		memOK = errMem == nil
		ioOK = errBlk == nil
	}

	if !cpuOK {
		missing = append(missing, "cpu cgroup controller unavailable")
	}
	if !memOK {
		missing = append(missing, "memory cgroup controller unavailable")
	}
	dev := DetectBlockDevice(dataDir)
	if !ioOK {
		missing = append(missing, "io/blkio cgroup controller unavailable (Disk IOPS limits not supported by host kernel)")
	} else if dev == "" {
		ioOK = false
		missing = append(missing, "host block device could not be auto-detected from /proc/mounts")
	}
	if len(missing) > 0 {
		note = strings.Join(missing, "; ")
	}
	return cpuOK, memOK, ioOK, note
}
