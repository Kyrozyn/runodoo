package monitoring

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/runodoo/runodoo/internal/models"
)

type logShipper struct {
	mgr      *Manager
	mu       sync.Mutex
	lastNano map[string]int64
	stopCh   chan struct{}
	wg       sync.WaitGroup
}

func newLogShipper(m *Manager) *logShipper {
	return &logShipper{
		mgr:      m,
		lastNano: make(map[string]int64),
	}
}

// StartLogShipper starts the background goroutine that ships Odoo & PostgreSQL container logs to Loki.
func (m *Manager) StartLogShipper() {
	m.shipper.start()
}

// StopLogShipper stops the background log shipper gracefully.
func (m *Manager) StopLogShipper() {
	m.shipper.stop()
}

func (s *logShipper) start() {
	s.mu.Lock()
	if s.stopCh != nil {
		s.mu.Unlock()
		return
	}
	s.stopCh = make(chan struct{})
	stopCh := s.stopCh
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				s.tick()
			}
		}
	}()
}

func (s *logShipper) stop() {
	s.mu.Lock()
	ch := s.stopCh
	s.stopCh = nil
	s.mu.Unlock()
	if ch != nil {
		close(ch)
		s.wg.Wait()
	}
}

func (s *logShipper) tick() {
	st := s.mgr.store.Get()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	for _, inst := range st.Instances {
		if !inst.Monitoring.Installed {
			continue
		}
		_, _, _, loki := containerNamesFor(inst)
		if s.mgr.inspectStatus(ctx, loki) != "running" {
			continue
		}
		s.shipContainer(ctx, inst, inst.ContainerName, "odoo", loki)
		s.shipContainer(ctx, inst, inst.DBContainerName, "postgres", loki)
	}
}

func (s *logShipper) shipContainer(ctx context.Context, inst models.OdooInstance, containerName, service, lokiContainer string) {
	if containerName == "" {
		return
	}
	key := inst.ID + ":" + containerName

	s.mu.Lock()
	last := s.lastNano[key]
	s.mu.Unlock()

	var sinceUnix int64
	if last > 0 {
		sinceUnix = last / 1e9
	} else {
		// On first poll, grab the last 5 minutes of logs.
		sinceUnix = time.Now().Add(-5 * time.Minute).Unix()
	}

	raw, err := s.mgr.docker.ContainerLogsSince(ctx, containerName, sinceUnix)
	if err != nil || strings.TrimSpace(raw) == "" {
		return
	}

	byLevel := make(map[string][][2]string)
	maxNano := last

	for _, line := range strings.Split(raw, "\n") {
		if line == "" {
			continue
		}
		var tsNano int64
		msg := line
		if sp := strings.IndexByte(line, ' '); sp > 0 {
			if t, err := time.Parse(time.RFC3339Nano, line[:sp]); err == nil {
				tsNano = t.UnixNano()
				msg = line[sp+1:]
			}
		}
		if tsNano == 0 {
			tsNano = time.Now().UnixNano()
		}
		if tsNano <= last {
			continue
		}
		if tsNano <= maxNano {
			tsNano = maxNano + 1
		}
		maxNano = tsNano
		lvl := detectLogLevel(msg)
		byLevel[lvl] = append(byLevel[lvl], [2]string{strconv.FormatInt(tsNano, 10), msg})
	}

	if len(byLevel) == 0 {
		return
	}

	streams := make([]map[string]any, 0, len(byLevel))
	for lvl, vals := range byLevel {
		streams = append(streams, map[string]any{
			"stream": map[string]string{
				"instance":  inst.Name,
				"container": containerName,
				"service":   service,
				"level":     lvl,
			},
			"values": vals,
		})
	}

	payload := map[string]any{
		"streams": streams,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://%s:3100/loki/api/v1/push", lokiContainer), bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()

	if resp.StatusCode < 300 {
		s.mu.Lock()
		if maxNano > s.lastNano[key] {
			s.lastNano[key] = maxNano
		}
		s.mu.Unlock()
	}
}

func detectLogLevel(msg string) string {
	upper := strings.ToUpper(msg)
	switch {
	case strings.Contains(upper, " ERROR ") ||
		strings.Contains(upper, "ERROR:") ||
		strings.Contains(upper, " CRITICAL ") ||
		strings.Contains(upper, "FATAL:") ||
		strings.Contains(upper, "PANIC:") ||
		strings.Contains(upper, "TRACEBACK") ||
		strings.Contains(upper, "EXCEPTION"):
		return "error"
	case strings.Contains(upper, " WARNING ") ||
		strings.Contains(upper, "WARNING:") ||
		strings.Contains(upper, " WARN "):
		return "warning"
	case strings.Contains(upper, " DEBUG ") ||
		strings.Contains(upper, "DEBUG:"):
		return "debug"
	default:
		return "info"
	}
}
