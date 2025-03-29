# MCP Kroki Server

An MCP (Model Context Protocol) server for converting Mermaid diagrams to SVG images using Kroki.io.

## Features

- Generate URLs for diagrams using Kroki.io
- Download diagrams as SVG, PNG, PDF, or JPEG files
- Support for multiple diagram formats:
  - Mermaid
  - PlantUML
  - Graphviz
  - And many more (see Kroki.io documentation)

## Installation

### 実行のためのインストール

```bash
git clone https://github.com/tkoba1974/mcp-kroki.git
cd mcp-kroki
npm install
npm run build
```

### グローバルインストール

プロジェクトディレクトリで以下を実行すると、コマンドとして使用できるようになります：

```bash
npm install
npm run build
npm run link
```

これにより、`mcp-kroki`コマンドがグローバルに利用可能になります。

### npxで実行

npxを使用して直接実行することも可能です：

```bash
# ビルド後にローカルのプロジェクトディレクトリから実行
npm run build
npx .

# または、プロジェクトをパスで指定して実行
npx /path/to/mcp-kroki
```

## Usage

The server provides two main tools:

### 1. Generate Diagram URL

Generates a URL for a diagram using Kroki.io.

Parameters:
- `type`: The diagram type (e.g., "mermaid", "plantuml")
- `content`: The diagram content in the specified format
- `outputFormat` (optional): The output format (svg, png, pdf, jpeg, base64)

### 2. Download Diagram

Downloads a diagram to a local file.

Parameters:
- `type`: The diagram type (e.g., "mermaid", "plantuml")
- `content`: The diagram content in the specified format
- `outputPath`: The path where the diagram should be saved
- `outputFormat` (optional): The output format (svg, png, pdf, jpeg)

## Example

```javascript
// Generate a URL for a Mermaid diagram
const result = await callTool('generate_diagram_url', {
  type: 'mermaid',
  content: 'graph TD; A-->B; B-->C; C-->D;',
  outputFormat: 'svg'
});

// Download a Mermaid diagram
const result = await callTool('download_diagram', {
  type: 'mermaid',
  content: 'graph TD; A-->B; B-->C; C-->D;',
  outputPath: '/path/to/diagram.svg'
});
```

## How It Works

The server uses the Kroki.io API to convert diagrams. The diagram content is compressed and encoded before being sent to Kroki.io.

## Usage with Claude Desktop

Add to your Claude Desktop configuration file (claude_desktop_config.json):

```json
{
  "external_tools": [
    {
      "name": "mcp-kroki",
      "capability_id": "kroki-server",
      "command": [
        "node",
        "/path/to/mcp-kroki/build/index.js"
      ]
    }
  ]
}
```

グローバルインストールした場合は、次のようにより簡単な設定も可能です：

```json
{
  "external_tools": [
    {
      "name": "mcp-kroki",
      "capability_id": "kroki-server",
      "command": [
        "mcp-kroki"
      ]
    }
  ]
}
```

npxを使用する場合：

```json
{
  "external_tools": [
    {
      "name": "mcp-kroki",
      "capability_id": "kroki-server",
      "command": [
        "npx",
        "/path/to/mcp-kroki"
      ]
    }
  ]
}
```

## License

MIT
