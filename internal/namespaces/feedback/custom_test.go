package feedback

import (
	"os/exec"
	"runtime"
	"testing"

	"github.com/alecthomas/assert"
	"github.com/hashicorp/go-version"
	"github.com/scaleway/scaleway-cli/internal/core"
)

func Test_FeedbackBug(t *testing.T) {
	t.Run("simple", core.Test(&core.TestConfig{
		Commands: GetCommands(),
		Cmd:      "scw feedback bug",
		BuildInfo: core.BuildInfo{
			Version:   version.Must(version.NewSemver("v0.0.0")),
			BuildDate: "unknown",
			GoVersion: "runtime.Version()",
			GitBranch: "unknown",
			GitCommit: "unknown",
			GoArch:    "runtime.GOARCH",
			GoOS:      "runtime.GOOS",
		},
		OverrideExec: func(ctx *core.ExecFuncCtx, cmd *exec.Cmd) (exitCode int, err error) {
			var observed string
			switch runtime.GOOS {
			case windows:
				// 0: "rundll32", 1: "url.dll,FileProtocolHandler" 2: url
				observed = cmd.Args[2]
			default:
				observed = cmd.Args[1]
			}
			assert.Equal(t,
				"https://github.com/scaleway/scaleway-cli/issues/new?body=%0A%23%23+Description%3A%0A%0A%23%23+How+to+reproduce%3A%0A%0A%23%23%23+Command+attempted%0A%0A%23%23%23+Expected+Behavior%0A%0A%23%23%23+Actual+Behavior%0A%0A%23%23+More+info%0A%0A%23%23+Version%0A%0Aversion+++++0.0.0%0Abuild-date++unknown%0Ago-version++runtime.Version%28%29%0Agit-branch++unknown%0Agit-commit++unknown%0Ago-arch+++++runtime.GOARCH%0Ago-os+++++++runtime.GOOS%0A&issueTemplate=bug_report.md&labels=bug",
				observed)

			return 0, nil
		},
		Check: core.TestCheckCombine(
			core.TestCheckGolden(),
			core.TestCheckExitCode(0),
		),
	}))
}

func Test_FeedbackFeature(t *testing.T) {
	t.Run("simple", core.Test(&core.TestConfig{
		Commands: GetCommands(),
		Cmd:      "scw feedback feature",
		BuildInfo: core.BuildInfo{
			Version:   version.Must(version.NewSemver("v0.0.0")),
			BuildDate: "unknown",
			GoVersion: "runtime.Version()",
			GitBranch: "unknown",
			GitCommit: "unknown",
			GoArch:    "runtime.GOARCH",
			GoOS:      "runtime.GOOS",
		},
		OverrideExec: func(ctx *core.ExecFuncCtx, cmd *exec.Cmd) (exitCode int, err error) {
			var observed string
			switch runtime.GOOS {
			case windows:
				// 0: "rundll32", 1: "url.dll,FileProtocolHandler" 2: url
				observed = cmd.Args[2]
			default:
				observed = cmd.Args[1]
			}
			assert.Equal(t,
				"https://github.com/scaleway/scaleway-cli/issues/new?body=%0A%23%23+Description%0A%0A%23%23+How+this+functionality+would+be+exposed%0A%0A%23%23+References%0A%0A%23%23+Version%0A%0Aversion+++++0.0.0%0Abuild-date++unknown%0Ago-version++runtime.Version%28%29%0Agit-branch++unknown%0Agit-commit++unknown%0Ago-arch+++++runtime.GOARCH%0Ago-os+++++++runtime.GOOS%0A&issueTemplate=feature_request.md&labels=enhancement",
				observed)

			return 0, nil
		},
		Check: core.TestCheckCombine(
			core.TestCheckGolden(),
			core.TestCheckExitCode(0),
		),
	}))
}
