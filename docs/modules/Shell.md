# Shell

Allows you to run custom shell commands from the ModelOps Handler.

> **Warning**: The module does not parses the output nor checks that the command is not
> destructive before running. It is up to the user to judge the security implications when
> running the module. Also, the `shell` command will be executed with the same level of
> permissions that the `handler` was called with.

## Example

```yaml
- module: Shell
  props:
    command: ls
    args:
      - -alh
      - .
```

## Props:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| command | `string` | Command to execute | `false` |  |
| args | `string` | Command arguments to provide to the command | `true` | `` |

## Output:

| Name | Type | Description | Optional | Default |
| ---- | ---- | ----------- | -------- | ------- |
| command | `string` | Command to execute | `false` |  |
| args | `string` | Command arguments to provide to the command | `true` | `` |
| stdout | `string` | Command stdout | `true` |  |
| stdoutLines | `string` | Command stdout lines | `true` | `` |
| stderr | `string` | Command stderr | `true` |  |
| stderrLines | `string` | Command stderr lines | `true` | `` |
