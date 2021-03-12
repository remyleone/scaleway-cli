/******************************************************************************
 * Scaleway CLI release script.
 *
 * This script will trigger a release process for the scaleway CLI.
 *
 * The script will proceed as follow:
 *   - Create a new remote `scaleway-release` that points to main repo
 *   - Prompt the new version number
 *   - Create release commit
 *     - Generate a changelog
 *     - Update version in cmd/scw/main.go
 *     - Update version in the README
 *     - Ask to review changes
 *     - Create a release PR on github
 *   - Create a release
 *     - Build binary that should be upload on the github release with their SHA256SUM
 *     - Create a github release
 *     - Attach compiled binary to the github release
 *   - Update S3 version file
 *   - Create a post release commit
 *     - Update cmd/scw/main.go to add +dev at the end
 *     - Ask to merge this changes to master via PR
 *   - Delete temporary remote `scaleway-release` that was created earlier
 ******************************************************************************/

/*
 * Required parameters
 */
// A valid github personal token that should have write access to github repo.
// Used only to create PR and Github Release
const GITHUB_TOKEN=process.env.GITHUB_TOKEN;
// A scaleway access key that should have write access to the devtool bucket.
const SCW_ACCESS_KEY=process.env.SCW_ACCESS_KEY;
// A scaleway secet key that should have write access to the devtool bucket.
const SCW_SECRET_KEY=process.env.SCW_SECRET_KEY;


/*
 * Global configuration
 */
// The root git directory. All future path should be relative to this one.
const ROOT_DIR = "../..";
// The script used to build release binary
const BUILD_SCRIPT = "./scripts/build.sh";
// The directory that contains release binary created by BUILD_SCRIPT
const BIN_DIR_PATH = "./bin/";
// Path to README file
const README_PATH = "./README.md";
// Path to CHANGELOG file
const CHANGELOG_PATH = "./CHANGELOG.md";
// Go file that contain the version string to replace during release process.
const GO_VERSION_PATH = "./cmd/scw/main.go";
// Golden file used by test that checks whether the CLI is up to date or not.
const VERSION_TEST_GOLDEN_PATH = "./internal/core/testdata/test-check-version-outdated-version.stderr.golden";
// Name of the temporary branch that will be used during the release process.
const TMP_BRANCH = "new-release";
// Name of the temporary remote that will be used during the release process.
const TMP_REMOTE = "scaleway-release";
// Name of the github repo namespace (user or orga).
const GITHUB_OWNER = "scaleway";
// Name of the github repo.
const GITHUB_REPO = "scaleway-cli";
// The branch on which we want to perform the release
const GITHUB_RELEASED_BRANCH = "master";
// Name of the devtool bucket.
const S3_DEVTOOL_BUCKET = "scw-devtools";
// Region of the devtool bucket .
const S3_DEVTOOL_BUCKET_REGION = "nl-ams";
// S3 object name of the version file that should be updated during release.
const S3_VERSION_OBJECT_NAME = "scw-cli-v2-version";
// Name of the Docker image on hub.docker.com
const DOCKER_IMAGE_NAME = "scaleway/cli";


async function main() {
    // Initialize s3 client
    if (!SCW_ACCESS_KEY || !SCW_SECRET_KEY) {
        throw new Error(`You must provide a valid access and secret key`)
    }
    const s3 = new AWS.S3({
        credentials: new AWS.Credentials(SCW_ACCESS_KEY, SCW_SECRET_KEY),
        endpoint: `s3.${S3_DEVTOOL_BUCKET_REGION}.scw.cloud`,
        region: `${S3_DEVTOOL_BUCKET_REGION}`,
    });

    await prompt(`Make sure that your local Docker Daemon is logged on hub.docker.com AND that you can push to Scaleway's Docker organization.`.magenta);

    //
    // Trying to find the latest tag to generate changelog
    //
    console.log("Trying to find last release tag".blue);
    const lastSemverTag = git("tag")
        .trim()
        .split("\n")
        .filter(semver.valid)
        .sort((a, b) => semver.rcompare(semver.clean(a), semver.clean(b)))[0];
    const lastVersion =  semver.clean(lastSemverTag);
    console.log(`    Last found release tag was ${lastSemverTag}`.green);

    console.log("Listing commit since last release".blue);
    const commits = (await getStream.array(gitRawCommits({ from: lastSemverTag, format: "%s" }))).map(c => c.toString().trim());
    commits.forEach(c => console.log(`    ${c}`.grey));
    console.log(`    We found ${commits.length} commits since last release`.green);

    console.log(`    Last found release tag was ${lastSemverTag}`.grey);
    const newVersion = semver.clean(await prompt("Enter new version: ".magenta));
    if (!newVersion) {
        throw new Error(`invalid version`);
    }

    //
    // Creating release commit
    //

    console.log(`Updating ${README_PATH}, ${CHANGELOG_PATH} and ${GO_VERSION_PATH}`.blue);
    const changelog = buildChangelog(newVersion, commits);
    changelog.body = externalEditor.edit(changelog.body);

    replaceInFile(README_PATH, lastVersion, newVersion);
    replaceInFile(CHANGELOG_PATH, "# Changelog", `# Changelog\n\n${changelog.header}\n\n${changelog.body}\n`);
    replaceInFile(GO_VERSION_PATH, /Version = "[^"]*"/, `Version = "v${newVersion}"`);
    console.log(`    Update success`.green);

    await prompt(`Please review ${README_PATH}, ${CHANGELOG_PATH} and ${GO_VERSION_PATH}. When everything is fine hit enter to continue ...`.magenta);

    console.log(`Creating release commit`.blue);
    git("checkout", "-b", TMP_BRANCH);
    git("add", README_PATH, CHANGELOG_PATH, GO_VERSION_PATH);
    git("commit", "-m", `chore: release ${newVersion}`);
    git("push", "-f", "--set-upstream", TMP_REMOTE, TMP_BRANCH);

    const prResp = await octokit.pulls.create({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        base: GITHUB_RELEASED_BRANCH,
        head: TMP_BRANCH,
        title: `chore: release v${newVersion}`
    });
    console.log(`    Successfully create pull request: ${prResp.data.html_url}`.green);
    await prompt(`Hit enter when its merged .....`.magenta);

    //
    // Update version file on s3
    //
    console.log("Updating version file on s3".blue);
    await util.promisify(s3.putObject.bind(s3))({
        ACL: "public-read",
        Body: newVersion,
        Bucket: S3_DEVTOOL_BUCKET,
        Key: S3_VERSION_OBJECT_NAME
    });
    console.log(`    Successfully updated s3 version file: https://${S3_DEVTOOL_BUCKET}.s3.${S3_DEVTOOL_BUCKET_REGION}.scw.cloud/${S3_VERSION_OBJECT_NAME}`.green);
    await prompt(`Hit enter to continue .....`.magenta);

    console.log(`🚀 Released with Success `.green);
}

function git(...args) {
    return exec("git", ...args)
}

function docker(...args) {
    return exec("docker", ...args)
}

function exec(cmd, ...args) {
    console.log(`    ${cmd} ${args.join(" ")}`.grey);
    const { stdout, status, stderr } = spawnSync(cmd, args, { encoding: "utf8" });
    if (status !== 0) {
        throw new Error(`return status ${status}\n${stderr}\n`);
    }
    return stdout;
}


function replaceInFile(path, oldStr, newStr) {
    console.log(`    Editing ${path}`.grey);
    let content = fs.readFileSync(path, { encoding: "utf8" });
    if (oldStr instanceof RegExp) {
        content = content.replace(oldStr, newStr);
    } else {
        content = content.split(oldStr).join(newStr);
    }

    fs.writeFileSync(path, content);
}


function buildChangelog(newVersion, commits) {
    const changelogLines = { feat: [], fix: [], others: [] };
    commits.forEach(commit => {
        const result = COMMIT_REGEX.exec(commit);

        // If commit do not match a valid commit regex we add it in others section without formatting
        if (!result) {
            console.warn(`WARNING: Malformed commit ${commit}`.yellow);
            changelogLines.others.push(commit);
            return;
        }
        const stdCommit = result.groups;

        // If commit type is not one of [feat, fix] we add it in the other group. This will probably need further human edition.
        if (!(stdCommit.type in changelogLines)) {
            stdCommit.scope = [ stdCommit.type, stdCommit.scope ].filter(str => str).join(" - ");
            stdCommit.type = "others";
        }

        const line = [
            `*`,
            stdCommit.scope ? `**${stdCommit.scope}**:` : "",
            stdCommit.message,
            stdCommit.mr ? `([#${stdCommit.mr}](${GITHUB_REPO_URL}/pull/${stdCommit.mr}))` : ""
        ]
            .map(s => s.trim())
            .filter(v => v)
            .join(" ");
        changelogLines[stdCommit.type].push(line);
    });

    const changelogSections = [];
    if (changelogLines.feat) {
        changelogSections.push("### Features\n\n" + changelogLines.feat.sort().join("\n"));
    }
    if (changelogLines.fix) {
        changelogSections.push("### Fixes\n\n" + changelogLines.fix.sort().join("\n"));
    }
    if (changelogLines.others) {
        changelogSections.push("### Others\n\n" + changelogLines.others.sort().join("\n"));
    }
    return {
        header: `## v${newVersion} (${new Date().toISOString().substring(0, 10)})`,
        body: changelogSections.join("\n\n"),
    }
}

main().catch(console.error);
