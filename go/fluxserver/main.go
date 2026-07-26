package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// Minimal Flux L0 unary server (JSON) — proves polyglot wire compatibility.
// Run: go run .   (from go/fluxserver)
// Speaks the same paths/envelopes as @flux/runtime for GetUser.

type fluxRequest struct {
	Input  map[string]any `json:"input"`
	Select map[string]any `json:"select"`
	Op     string         `json:"op,omitempty"`
}

type fluxResponse struct {
	Data       any            `json:"data"`
	Error      any            `json:"error"`
	Extensions map[string]any `json:"extensions,omitempty"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8788"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "runtime": "go", "protocol": "flux/1"})
	})
	mux.HandleFunc("/flux.v1.UserService/GetUser", handleGetUser)
	fmt.Println("Flux Go server listening on http://localhost:" + port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		panic(err)
	}
}

func handleGetUser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Flux-Protocol-Version", "1")
	w.Header().Set("Content-Type", "application/flux+json")
	if tp := r.Header.Get("traceparent"); tp != "" {
		w.Header().Set("traceparent", tp)
	}

	var input map[string]any
	var sel map[string]any

	switch r.Method {
	case http.MethodGet:
		msg := r.URL.Query().Get("message")
		if msg == "" {
			msg = "{}"
		}
		_ = json.Unmarshal([]byte(msg), &input)
		if s := r.URL.Query().Get("select"); s != "" {
			_ = json.Unmarshal([]byte(s), &sel)
		}
		w.Header().Set("Cache-Control", "public, max-age=60")
	case http.MethodPost:
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeErr(w, 400, "invalid_argument", err.Error())
			return
		}
		var req fluxRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeErr(w, 400, "invalid_argument", err.Error())
			return
		}
		input = req.Input
		sel = req.Select
	default:
		writeErr(w, 405, "invalid_argument", "method not allowed")
		return
	}

	id, _ := input["id"].(string)
	if id == "" {
		writeErr(w, 400, "invalid_argument", "id required")
		return
	}
	user := map[string]any{
		"id":    id,
		"name":  "Ada Lovelace",
		"email": "ada@analytical.engine",
		"posts": []map[string]any{
			{"id": "p1", "title": "Notes on the Analytical Engine", "body": "..."},
			{"id": "p2", "title": "Bernoulli numbers", "body": "..."},
		},
	}
	data := project(user, sel)
	etag := `"` + "flux-go-" + id + `"`
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, 200, fluxResponse{
		Data:       data,
		Error:      nil,
		Extensions: map[string]any{"cost": 1, "runtime": "go"},
	})
}

func project(value any, sel map[string]any) any {
	if sel == nil {
		return value;
	}
	obj, ok := value.(map[string]any)
	if !ok {
		return value
	}
	out := map[string]any{}
	for k, sub := range sel {
		child, exists := obj[k]
		if !exists {
			continue
		}
		switch s := sub.(type) {
		case bool:
			if s {
				out[k] = child
			}
		case map[string]any:
			if arr, ok := child.([]map[string]any); ok {
				mapped := make([]any, 0, len(arr))
				for _, item := range arr {
					mapped = append(mapped, project(item, s))
				}
				out[k] = mapped
			} else if arr, ok := child.([]any); ok {
				mapped := make([]any, 0, len(arr))
				for _, item := range arr {
					mapped = append(mapped, project(item, s))
				}
				out[k] = mapped
			} else {
				out[k] = project(child, s)
			}
		}
	}
	return out
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, fluxResponse{
		Data:  nil,
		Error: map[string]string{"code": code, "message": msg},
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/flux+json")
	}
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	_ = enc.Encode(v)
}
