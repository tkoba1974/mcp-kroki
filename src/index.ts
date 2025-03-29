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

  private async generateDiagramUrl(options: DiagramOptions): Promise<string> {
    this.validateDiagramType(options.type);
    const outputFormat = options.outputFormat || 'svg';
    this.validateOutputFormat(outputFormat);

    // Kroki expects compressed diagram content
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
          description: 'Download a diagram image to a local file. This tool converts diagram code (such as Mermaid) into an image file and saves it to the specified location on your filesystem. Useful for generating diagrams for presentations, documentation, or other offline use.',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Diagram type (e.g., "mermaid" for Mermaid diagrams, "plantuml" for PlantUML, "graphviz" for GraphViz DOT). Supports the same diagram types as Kroki.io, including mermaid, plantuml, graphviz, c4plantuml, excalidraw, and many others.'
              },
              content: {
                type: 'string',
                description: 'The diagram content in the specified format. This is the actual diagram code that will be converted to an image (e.g., the Mermaid syntax for a flowchart or sequence diagram).'
              },
              outputPath: {
                type: 'string',
                description: 'The complete file path where the diagram image should be saved, including the filename and extension (e.g., "/Users/username/Documents/diagram.svg"). The directory must exist or be creatable by the system.'
              },
              outputFormat: {
                type: 'string',
                description: 'The format of the output image. If not specified, the format will be determined from the file extension of the outputPath. Options are: "svg" (vector graphics, best for web and scaling), "png" (raster image, good for presentations), "pdf" (document format, good for printing), or "jpeg" (compressed raster image).'
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
            
            return {
              content: [
                {
                  type: 'text',
                  text: url
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
          try {
            const { type, content, outputPath, outputFormat } = request.params.arguments as {
              type: string;
              content: string;
              outputPath: string;
              outputFormat?: string;
            };
            
            // Ensure the output directory exists
            const directory = path.dirname(outputPath);
            await fs.mkdir(directory, { recursive: true });
            
            // Generate the URL for the diagram
            const format = outputFormat || path.extname(outputPath).slice(1) || 'svg';
            const url = await this.generateDiagramUrl({ 
              type, 
              content,
              outputFormat: format
            });
            
            // Download the diagram
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.writeFile(outputPath, response.data);
            
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
              throw error;
            }
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to download diagram: ${error?.message || 'Unknown error'}`
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
