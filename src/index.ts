#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as pako from 'pako';
import * as fs from 'fs/promises';
import * as path from 'path';

const KROKI_BASE_URL = 'https://kroki.io';

interface DiagramOptions {
  type: string;
  content: string;
  outputFormat?: string;
}

class KrokiServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'kroki-server',
        version: '1.0.0',
        description: 'A Model Context Protocol server that converts Mermaid diagrams and other formats to SVG/PNG/PDF using Kroki.io. This server provides tools to generate diagram URLs and download diagram files.',
        vendor: 'Takao',
        homepageUrl: 'https://kroki.io/',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private validateDiagramType(type: string): void {
    const validTypes = [
      'mermaid', 'plantuml', 'graphviz', 'c4plantuml', 
      'excalidraw', 'erd', 'svgbob', 'nomnoml', 'wavedrom', 
      'blockdiag', 'seqdiag', 'actdiag', 'nwdiag', 'packetdiag', 
      'rackdiag', 'umlet', 'ditaa', 'vega', 'vegalite'
    ];
    
    if (!validTypes.includes(type)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid diagram type. Must be one of: ${validTypes.join(', ')}`
      );
    }
  }

  private validateOutputFormat(format: string): void {
    const validFormats = ['svg', 'png', 'pdf', 'jpeg', 'base64'];
    
    if (!validFormats.includes(format)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid output format. Must be one of: ${validFormats.join(', ')}`
      );
    }
  }

  // 新しい関数: 画像データを取得し、エラーをチェックし、SVGをスケーリングする
  private async getDiagramData(options: DiagramOptions & { scale?: number }): Promise<{ data: Buffer, format: string }> {
    this.validateDiagramType(options.type);
    const outputFormat = options.outputFormat || 'svg';
    this.validateOutputFormat(outputFormat);

    // Kroki expects compressed diagram content
    const deflated = pako.deflate(options.content);
    const encodedContent = Buffer.from(deflated).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const url = `${KROKI_BASE_URL}/${options.type}/${outputFormat}/${encodedContent}`;

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        // text/html も受け入れるように validateStatus を調整する可能性があるが、
        // まずは 2xx 応答の中身をチェックする方針で進める
        validateStatus: (status) => status >= 200 && status < 300,
      });
      let data = Buffer.from(response.data);
      const scale = options.scale ?? 1.0;
      const contentType = response.headers['content-type']?.toLowerCase() || '';

      // --- HTMLエラーページの検出 ---
      // Content-TypeがHTML、または内容がHTMLタグで始まる場合
      if (contentType.includes('text/html') || data.toString('utf-8', 0, 100).trim().startsWith('<html') || data.toString('utf-8', 0, 100).trim().startsWith('<!DOCTYPE html')) {
          // HTMLの内容からエラーメッセージを抽出する試み (Krokiのエラーページ構造に依存)
          const htmlContent = data.toString('utf-8');
          const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
          const bodyMatch = htmlContent.match(/<body>([\s\S]*?)<\/body>/i); // より広い範囲を対象に
          let extractedMessage = titleMatch ? titleMatch[1].trim() : 'Unknown error (HTML response)';
          // "Unable to decode"のような特徴的なメッセージを探す
          if (bodyMatch && /unable to decode/i.test(bodyMatch[1])) {
              extractedMessage = "デコードエラー: Krokiがソースをデコードできませんでした。記述形式や内容を確認してください。";
              // bodyからもう少し情報を取れないか試す (例: <pre> タグ)
              const preMatch = bodyMatch[1].match(/<pre>([\s\S]*?)<\/pre>/i);
              if (preMatch && preMatch[1].trim()) {
                  extractedMessage += `\n詳細:\n---\n${preMatch[1].trim()}\n---`;
              }
          } else if (bodyMatch) {
              // 他のHTMLエラーの場合、bodyの内容を一部表示する試み
              const plainBody = bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (plainBody.length > 0 && plainBody.length < 300) { // 長すぎない場合
                  extractedMessage += ` (内容: ${plainBody}...)`;
              }
          }
          throw new McpError(ErrorCode.InvalidParams, `Krokiエラー: ${extractedMessage}`);
      }

      // --- 既存のSVG内エラーチェックとスケーリング ---
      if ((outputFormat === 'svg' || outputFormat === 'base64') && data.length > 0) {
        let svgContent = data.toString('utf-8');

        // SVG内のエラーテキストチェック
        const errorTextMatch = svgContent.match(/<text[^>]*class="error"[^>]*>([\s\S]*?)<\/text>|<text[^>]*fill="red"[^>]*>([\s\S]*?)<\/text>/i);
        if (errorTextMatch) {
           const rawErrorMessage = (errorTextMatch[1] || errorTextMatch[2] || 'Unknown diagram error').trim();
           const decodedErrorMessage = rawErrorMessage
               .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<br\/>/g, '\n');
           throw new McpError(ErrorCode.InvalidParams, `ダイアグラム生成エラー (SVG内):\n${decodedErrorMessage}\n\n記述内容を確認してください。`);
        }

        // --- スケーリング処理 (scale > 1 の場合のみ) ---
        if (scale > 1.0 && outputFormat === 'svg') { // base64はスケールしない
           try {
             svgContent = svgContent.replace(/<svg([^>]*)>/, (match, attributes) => {
               let width = attributes.match(/width="([^"]+)"/);
               let height = attributes.match(/height="([^"]+)"/);
               let newAttrs = attributes;

               if (width && width[1]) {
                 const widthVal = parseFloat(width[1]);
                 const widthUnit = width[1].replace(/[0-9.]/g, '') || 'px'; // 単位を保持 (pxがデフォルト)
                 if (!isNaN(widthVal)) {
                   newAttrs = newAttrs.replace(width[0], `width="${(widthVal * scale).toFixed(2)}${widthUnit}"`);
                 }
               }
               if (height && height[1]) {
                 const heightVal = parseFloat(height[1]);
                 const heightUnit = height[1].replace(/[0-9.]/g, '') || 'px';
                 if (!isNaN(heightVal)) {
                   newAttrs = newAttrs.replace(height[0], `height="${(heightVal * scale).toFixed(2)}${heightUnit}"`);
                 }
               }
               // viewBoxがあれば、それに基づいてwidth/heightを追加/更新することも可能だが、複雑になるため省略
               return `<svg${newAttrs}>`;
             });
             data = Buffer.from(svgContent, 'utf-8');
             console.error(`[KrokiServer] Applied scale ${scale} to SVG.`); // ログ追加
           } catch (e) {
               console.error(`[KrokiServer] Failed to apply scale ${scale} to SVG: ${e}`);
               // スケーリング失敗時は元のデータを使用
           }
        }
      }
      // TODO: PNG/JPEG/PDFなどのバイナリ形式のエラー検出は困難

      return { data, format: outputFormat };
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        let detail = `Kroki APIリクエスト失敗 (ステータス: ${error.response.status})`;
        let krokiMessage = '';
        // エラーレスポンスボディをテキストとして読み取ろうと試みる
        try {
          const responseText = Buffer.from(error.response.data).toString('utf-8');
          // krokiはエラー時にプレーンテキストでメッセージを返すことがある
          if (responseText && responseText.length < 500) { // 長すぎる場合は表示しない
             krokiMessage = responseText.trim();
             // detail = `${detail}: ${krokiMessage}`; // メッセージを結合しないように変更
          }
        } catch (e) { /* ignore read error */ }
        // 400 Bad Request は構文エラーの可能性が高い
        const errorCode = error.response.status === 400 ? ErrorCode.InvalidParams : ErrorCode.InternalError;
        const userMessage = error.response.status === 400
          ? `ダイアグラムの記述にエラーがあるようです (Kroki HTTP 400)。\n${krokiMessage ? `Krokiからの詳細情報:\n---\n${krokiMessage}\n---\n` : 'Krokiから詳細なエラー箇所情報は提供されませんでした。\n'}記述内容を確認してください。`
          : `${detail}${krokiMessage ? `\nKrokiからのメッセージ: ${krokiMessage}` : ''}`; // 他のHTTPエラーは変更しない
        throw new McpError(errorCode, userMessage);
      } else if (error instanceof McpError) {
        throw error; // 内部で投げられたMcpErrorはそのまま再スロー
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch diagram from Kroki: ${error?.message || 'Unknown network error'}`
      );
    }
  }

  // generateDiagramUrl は getDiagramData を使ってURLを返し、エラーチェックも行う
  private async generateDiagramUrl(options: DiagramOptions): Promise<string> {
     this.validateDiagramType(options.type);
     const outputFormat = options.outputFormat || 'svg';
     this.validateOutputFormat(outputFormat);

     // エラーチェックのために getDiagramData を呼び出す
     // outputFormatがbase64の場合、内部的にはsvgとして取得・チェックする
     const checkFormat = outputFormat === 'base64' ? 'svg' : outputFormat;
     await this.getDiagramData({ ...options, outputFormat: checkFormat }); // エラーがあればここで例外が発生

     // エラーがなければURLを組み立てて返す
     const deflated = pako.deflate(options.content);
     const encodedContent = Buffer.from(deflated).toString('base64')
       .replace(/\+/g, '-')
       .replace(/\//g, '_');
     return `${KROKI_BASE_URL}/${options.type}/${outputFormat}/${encodedContent}`;
   }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'generate_diagram_url',
          description: 'Generate a URL for a diagram using Kroki.io. This tool takes Mermaid diagram code or other supported diagram formats and returns a URL to the rendered diagram. The URL can be used to display the diagram in web browsers or embedded in documents.',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Diagram type (e.g., "mermaid" for Mermaid diagrams, "plantuml" for PlantUML, "graphviz" for GraphViz DOT, "c4plantuml" for C4 architecture diagrams, and many more). See Kroki.io documentation for all supported formats.'
              },
              content: {
                type: 'string',
                description: 'The diagram content in the specified format. For Mermaid diagrams, this would be the Mermaid syntax code (e.g., "graph TD; A-->B; B-->C;").'
              },
              outputFormat: {
                type: 'string',
                description: 'The format of the output image. Options are: "svg" (vector graphics, default), "png" (raster image), "pdf" (document format), "jpeg" (compressed raster image), or "base64" (base64-encoded SVG for direct embedding in HTML).'
              }
            },
            required: ['type', 'content']
          }
        },
        {
          name: 'download_diagram',
          description: 'Download a diagram image to a local file. This tool converts diagram code (such as Mermaid) into an image file and saves it to the specified location. Useful for generating diagrams for presentations, documentation, or other offline use. Includes an option to scale SVG output.',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Diagram type (e.g., "mermaid", "plantuml", "graphviz"). Supports the same diagram types as Kroki.io.'
              },
              content: {
                type: 'string',
                description: 'The diagram content in the specified format.'
              },
              outputPath: {
                type: 'string',
                description: 'The complete file path where the diagram image should be saved (e.g., "/Users/username/Documents/diagram.svg").'
              },
              outputFormat: {
                type: 'string',
                description: 'Output image format. If unspecified, derived from outputPath extension. Options: "svg", "png", "pdf", "jpeg".'
              },
              scale: {
                type: 'number',
                description: 'Optional scaling factor to apply to the diagram dimensions. Default is 1.0 (no scaling). This currently only affects SVG output format by attempting to modify width/height attributes.',
                default: 1.0,
                minimum: 0.1 // Add a minimum to prevent zero or negative scale
              }
            },
            required: ['type', 'content', 'outputPath']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'generate_diagram_url': {
          try {
            const { type, content, outputFormat } = request.params.arguments as {
              type: string;
              content: string;
              outputFormat?: string;
            };
            
            const url = await this.generateDiagramUrl({ type, content, outputFormat });
            
            // 成功した場合、チェック済みであることを示すメッセージと共にURLを返す
            return {
              content: [
                {
                  type: 'text',
                  text: `ダイアグラムURLを生成し、内容を確認しました。エラーは見つかりませんでした。\nURL: ${url}`
                }
              ]
            };
          } catch (error: any) {
            if (error instanceof McpError) {
              throw error;
            }
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to generate diagram URL: ${error?.message || 'Unknown error'}`
            );
          }
        }

        case 'download_diagram': {
          let targetPath = 'unknown path'; // エラーメッセージ用
          try {
            const { type, content, outputPath, outputFormat, scale } = request.params.arguments as {
              type: string;
              content: string;
              outputPath: string;
              outputFormat?: string;
              scale?: number; // scale を受け取る
            };
            targetPath = outputPath; // エラーメッセージ用にパスを保持

            // 出力パスからフォーマットを決定（指定がなければ）
            const determinedFormat = outputFormat || path.extname(outputPath).slice(1) || 'svg';

            // getDiagramData を呼び出して画像データを取得＆エラーチェック
            const { data, format } = await this.getDiagramData({
              type,
              content,
              outputFormat: determinedFormat,
              scale: scale ?? 1.0 // scale を渡す (デフォルトは 1.0)
            });

            // Ensure the output directory exists
            const directory = path.dirname(outputPath);
            await fs.mkdir(directory, { recursive: true });

            // 取得したデータをファイルに書き込む
            await fs.writeFile(outputPath, data);

            return {
              content: [
                {
                  type: 'text',
                  text: `Diagram saved to ${outputPath}`
                }
              ]
            };
          } catch (error: any) {
            if (error instanceof McpError) {
              // エラーメッセージにファイルパス情報を追加する
              error.message = `Failed to download diagram to ${targetPath}: ${error.message}`;
              throw error;
            }
            // 予期せぬエラー
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to download diagram to ${targetPath}: ${error?.message || 'Unknown error'}`
            );
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Kroki MCP server running on stdio');
  }
}

const server = new KrokiServer();
server.run().catch(console.error);
