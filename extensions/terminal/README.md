# SORA Terminal Executor Extension

Executes shell and PowerShell commands safely on behalf of SORA:

- **terminal_execute**: Run commands with output capturing, exit code detection, and timeout handling.

## Permissions Required
- `terminal`

## Safety Policies
- Catastrophic drive wiping or partition modification commands are blocked.
- Configurable `requireConfirmation` policy enforces manual approval for sensitive commands.
