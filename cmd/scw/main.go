package main

import (
	"os"
	"runtime"

	"github.com/hashicorp/go-version"
	"github.com/mattn/go-colorable"
	"github.com/scaleway/scaleway-cli/internal/core"
	"github.com/scaleway/scaleway-cli/internal/namespaces"
	"github.com/scaleway/scaleway-cli/internal/sentry"
)

var (
	// Version is updated manually
	Version = "dev"

	// These are GO constants
	GoVersion = runtime.Version()
	GoOS      = runtime.GOOS
	GoArch    = runtime.GOARCH
)

func main() {
	buildInfo := &core.BuildInfo{
		Version:   version.Must(version.NewSemver(Version)), // panic when version does not respect semantic versioning
		GoVersion: GoVersion,
		GoOS:      GoOS,
		GoArch:    GoArch,
	}

	// Catch every panic after this line. This will send an anonymous report on Scaleway's sentry.
	if buildInfo.IsRelease() {
		defer sentry.RecoverPanicAndSendReport(buildInfo)
	}

	exitCode, _, _ := core.Bootstrap(&core.BootstrapConfig{
		Args:      os.Args,
		Commands:  namespaces.GetCommands(),
		BuildInfo: buildInfo,
		Stdout:    colorable.NewColorableStdout(),
		Stderr:    colorable.NewColorableStderr(),
		Stdin:     os.Stdin,
	})

	os.Exit(exitCode)
}
