package object

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"text/template"

	"github.com/scaleway/scaleway-cli/internal/core"
	"github.com/scaleway/scaleway-sdk-go/scw"
)

type s3tool string

func (c s3tool) String() string {
	return string(c)
}

type s3config struct {
	AccessKey string
	SecretKey string
	Region    scw.Region
	Name      string
}

const (
	rclone = s3tool("rclone")
	s3cmd  = s3tool("s3cmd")
	mc     = s3tool("mc")
)

var supportedTools = []s3tool{
	rclone,
	s3cmd,
	mc,
}

const s3cmdTemplate = `# Generated by scaleway-cli command
# Configuration file for s3cmd https://s3tools.org/s3cmd
# Default location: $HOME/.s3cfg
[default]
access_key = {{ .AccessKey }}
bucket_location = {{ .Region }}
host_base = s3.{{ .Region }}.scw.cloud
host_bucket = %(bucket)s.s3.{{ .Region }}.scw.cloud
secret_key = {{ .SecretKey }}
use_https = True`

const rcloneTemplate = `# Generated by scaleway-cli command
# Configuration file for rclone https://rclone.org/s3/#scaleway
# Default location: $HOME/.config/rclone/rclone.conf 
[{{ .Name }}]
type = s3
env_auth = false
endpoint = s3.{{ .Region }}.scw.cloud
access_key_id = {{ .AccessKey }}
secret_access_key = {{ .SecretKey }}
region = {{ .Region }}
location_constraint =
acl = private
force_path_style = false
server_side_encryption =
storage_class =`

func newS3Config(ctx context.Context, region scw.Region, name string) (s3config, error) {
	client := core.ExtractClient(ctx)
	accessKey, accessExists := client.GetAccessKey()
	if !accessExists {
		return s3config{}, fmt.Errorf("no access key found")
	}
	secretKey, secretExists := client.GetSecretKey()
	if !secretExists {
		return s3config{}, fmt.Errorf("no secret key found")
	}
	if region == "" {
		defaultRegion, _ := client.GetDefaultRegion()
		region = defaultRegion
	}
	config := s3config{
		AccessKey: accessKey,
		SecretKey: secretKey,
		Region:    region,
		Name:      name,
	}
	return config, nil
}

func (c s3config) getPath(tool s3tool) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch tool {
	case s3cmd:
		return path.Join(homeDir, ".s3cfg"), nil
	case rclone:
		return path.Join(homeDir, ".config", "rclone", "rclone.conf"), nil
	case mc:
		return path.Join(homeDir, ".mc", "config.json"), nil
	default:
		return "", fmt.Errorf("unknown tool")
	}
}

func (c s3config) renderTemplate(configFileTemplate string) (string, error) {
	tmpl, err := template.New("configuration").Parse(configFileTemplate)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	err = tmpl.Execute(&buf, c)
	if err != nil {
		return "", err
	}

	return buf.String(), nil
}

func (c s3config) getConfigFile(tool s3tool) (string, error) {
	switch tool {
	case s3cmd:
		return c.renderTemplate(s3cmdTemplate)
	case rclone:
		return c.renderTemplate(rcloneTemplate)
	case mc:
		type hostconfig struct {
			URL       string `json:"url"`
			AccessKey string `json:"accessKey"`
			SecretKey string `json:"secretKey"`
			API       string `json:"api"`
		}
		type mcconfig struct {
			Version string                `json:"version"`
			Hosts   map[string]hostconfig `json:"hosts"`
		}
		m := mcconfig{
			Version: "9",
			Hosts: map[string]hostconfig{
				c.Name: {
					URL:       "https://s3." + c.Region.String() + ".scw.cloud",
					AccessKey: c.AccessKey,
					SecretKey: c.SecretKey,
					API:       "S3v2",
				},
			},
		}
		res, err := json.Marshal(m)
		if err != nil {
			return "", nil
		}
		return string(res), nil
	default:
		return "", fmt.Errorf("unknown tool")
	}
}
