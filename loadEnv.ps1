Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$')
    {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
Write-Output "env loaded"
