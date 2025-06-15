import React, { useState, useEffect, useRef } from 'react';
import OpenAI from 'openai'; // Added OpenAI import

const BACKEND_URL = 'http://localhost:5001'; // Flask backend URL
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com";

// Frontend's internal state representation
type FrontendAnalysisStatus = 'idle' | 'loading' | 'success' | 'error' | 'processing';

// Type for status messages received from backend
type BackendTaskActualStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface TaskStatusResponse {
  task_id: string;
  status: BackendTaskActualStatus; // Correctly typed based on what backend sends
  message: string;
  html_url?: string;
  html_content?: string; // Added for direct HTML content
  error_details?: string;
}

// Placeholder for DeepSeek API Key - IMPORTANT: Manage this securely!
// This key will be exposed in the browser. For production, consider a backend proxy.
const DUMMY_DEEPSEEK_API_KEY = 'sk-c9f6472191e04f628039a6e3643f6ff1'; // TODO: Replace with your actual key or manage securely

export default function ChatbotPage() {
  const [analysisStatus, setAnalysisStatus] = useState<FrontendAnalysisStatus>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [analysisResultUrl, setAnalysisResultUrl] = useState<string | null>(null);
  const [htmlReportContent, setHtmlReportContent] = useState<string | null>(null); // State for HTML content
  const [statusMessage, setStatusMessage] = useState<string>('点击按钮开始分析文档。');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Chat state ---
  const [chatMessages, setChatMessages] = useState<{ id: string, sender: string, text: string }[]>([]);
  const [userInput, setUserInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState<boolean>(false); // State for web search toggle

  // --- File Upload State ---
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [reportRequirementsInput, setReportRequirementsInput] = useState('生成5月手卫生培训与专项考核报告');

  const openai = new OpenAI({
    apiKey: DUMMY_DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_ENDPOINT,
    dangerouslyAllowBrowser: true,
  });

  const handleStartAnalysis = async () => {
    setAnalysisStatus('loading');
    setStatusMessage('正在请求开始分析...');
    setErrorMessage(null);
    setAnalysisResultUrl(null); // Clear previous URL result
    setHtmlReportContent(null); // Clear previous HTML content result

    if (!reportRequirementsInput.trim()) {
      setAnalysisStatus('idle'); // or 'error'
      setErrorMessage('报告生成需求不能为空。');
      setStatusMessage('请输入报告生成需求后重试。');
      return;
    }
    
    console.log("Starting analysis with prompt:", reportRequirementsInput);

    try {
      const response = await fetch(`${BACKEND_URL}/api/start-analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: reportRequirementsInput }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setTaskId(data.task_id);
      setAnalysisStatus('processing');
      setStatusMessage('分析任务已启动，正在处理中...');
    } catch (error) {
      console.error("Error starting analysis:", error);
      setAnalysisStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '启动分析失败，请检查后端服务。');
      setStatusMessage('分析启动失败。');
    }
  };

  useEffect(() => {
    if (taskId && (analysisStatus === 'processing' || analysisStatus === 'loading')) {
      const intervalId = setInterval(async () => {
        try {
          const response = await fetch(`${BACKEND_URL}/api/analysis-status/${taskId}`);
          if (!response.ok) {
            // If task ID is not found (404), it might mean backend restarted or task expired
            // Or a genuine server error
            if (response.status === 404) {
                throw new Error(`任务ID ${taskId} 未找到。可能已过期或后端服务已重启。`);
            }
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
          }
          const data: TaskStatusResponse = await response.json();
          
          setStatusMessage(data.message || '正在获取状态...');

          if (data.status === 'completed') {
            if (data.html_content) {
              setHtmlReportContent(data.html_content);
              setAnalysisResultUrl(null);
              setStatusMessage(data.message || '分析成功完成，报告内容已加载！');
            } else if (data.html_url) {
              setAnalysisResultUrl(data.html_url ? `${BACKEND_URL}${data.html_url}` : null);
              setHtmlReportContent(null);
              setStatusMessage(data.message || '分析成功完成，报告链接已获取！');
            } else {
              // Handle case where neither is provided, though backend logic should ensure one for completed tasks
              setStatusMessage(data.message || '分析成功完成，但未找到报告输出。');
            }
            setAnalysisStatus('success');
            setTaskId(null); // Clear task ID as it's done
            clearInterval(intervalId);
          } else if (data.status === 'failed') {
            setAnalysisStatus('error');
            setErrorMessage(data.error_details || data.message || '分析过程中发生未知错误。');
            setStatusMessage(data.message || '分析失败。');
            setTaskId(null); // Clear task ID
            clearInterval(intervalId);
          } else if (data.status === 'processing') {
            setAnalysisStatus('processing');
          } else if (data.status === 'pending') {
            setAnalysisStatus('processing');
            setStatusMessage(data.message || '任务正在等待执行...');
          }
        } catch (error) {
          console.error("Error fetching analysis status:", error);
          setAnalysisStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '获取分析状态失败。');
          setStatusMessage('获取分析状态时出错。');
          setTaskId(null);
          clearInterval(intervalId);
        }
      }, 10000); // Poll every 10 seconds

      return () => clearInterval(intervalId);
    }
  }, [taskId, analysisStatus]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // --- File Upload Handlers ---
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setUploadedFiles(prevFiles => [...prevFiles, ...Array.from(event.target.files || [])]);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      setUploadedFiles(prevFiles => [...prevFiles, ...Array.from(event.dataTransfer.files)]);
      // Optionally, reset the dataTransfer to prevent issues if the user drops again
      event.dataTransfer.clearData();
    }
  };

  const removeFile = (fileName: string) => {
    setUploadedFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
  };
  // --- End File Upload Handlers ---

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const currentUserInput = userInput; 
    const newUserMessage = { id: `user-${Date.now()}`, sender: 'user', text: currentUserInput };
    setChatMessages(prevMessages => [...prevMessages, newUserMessage]);
    setUserInput('');
    setStatusMessage('正在向大模型发送消息...');
    setErrorMessage(null);

    const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // Updated system prompt logic
    if (htmlReportContent) {
      apiMessages.push({
        role: 'system',
        content: 'You are an AI assistant. The user is viewing an HTML analysis report directly within their interface. Please answer their questions based on this document context that they are seeing. If a question seems unrelated to the document, use your general knowledge. Keep responses helpful and concise. The actual HTML content is: ' + htmlReportContent
      });
    } else if (analysisResultUrl) {
      apiMessages.push({
        role: 'system',
        content: `You are an AI assistant. The user has analyzed a document, and the analysis report is available at: ${analysisResultUrl}. Please answer questions based on this document. If the question seems unrelated to the document, use your general knowledge. Keep responses helpful and concise.`
      });
    }

    // Add recent chat history (up to last 6 messages, excluding any empty bot placeholders during generation)
    chatMessages.filter(msg => msg.text.trim() !== '').slice(-6).forEach(msg => {
      if (msg.sender === 'user') {
        apiMessages.push({
          role: 'user',
          content: msg.text
        });
      } else if (msg.sender === 'bot') { 
        apiMessages.push({
          role: 'assistant',
          content: msg.text
        });
      }
    });
    
    apiMessages.push({ role: 'user', content: currentUserInput });

    // TODO: Future - If isWebSearchEnabled is true, potentially modify apiMessages 
    // or use a different API endpoint/parameters to enable web search functionality for the LLM.
    // For example, you might add a specific tool_choice or a system instruction:
    // if (isWebSearchEnabled) {
    //   apiMessages.unshift({ role: 'system', content: 'Web search is enabled for this query. Please use it if relevant.'});
    // }

    const botMessageId = `bot-${Date.now()}`;
    setChatMessages(prevMessages => [...prevMessages, { id: botMessageId, sender: 'bot', text: "" }]);
    
    let accumulatedBotText = "";

    // This is the primary chat logic using OpenAI SDK. The old fetch to /api/chat is removed.
    try {
      setStatusMessage('大模型正在思考...');
      const stream = await openai.chat.completions.create({
        model: 'deepseek-chat', // TODO: Confirm model name
        messages: apiMessages,
        stream: true,
      });

      for await (const chunk of stream) {
        const contentDelta = chunk.choices[0]?.delta?.content || "";
        if (contentDelta) {
          accumulatedBotText += contentDelta;
          setChatMessages(prevMessages =>
            prevMessages.map(msg =>
              msg.id === botMessageId
                ? { ...msg, text: accumulatedBotText }
                : msg
            )
          );
        }
      }
      setStatusMessage('大模型已回复。');

    } catch (error) {
      console.error("Error sending message or processing stream:", error);
      const errorResponseMessage = error instanceof Error ? error.message : '与大模型通信失败或处理回复时出错。';
      setChatMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === botMessageId
            ? { ...msg, text: `错误: ${errorResponseMessage}` }
            : msg
        )
      );
      setStatusMessage('消息发送或处理回复失败。');
      setErrorMessage(errorResponseMessage);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-theme-bg-light p-4 sm:p-6 lg:p-8 font-sans max-w-screen-xl mx-auto">
      <header className="mb-6 pb-4 border-b border-theme-blue-dark">
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-text mb-2 ">文档分析与问答机器人</h1>
        <p className={`text-sm ${analysisStatus === 'error' ? 'text-red-600' : 'text-theme-text/80'}`}>
          {statusMessage}
        </p>
        {analysisStatus === 'error' && errorMessage && (
          <p className="text-sm text-red-700 italic mt-1">错误详情: {errorMessage}</p>
        )}
      </header>

      <main className="flex-grow flex flex-col gap-6">
        {/* Analysis Control and Display */} 
        <section>
          {analysisStatus !== 'success' && (
            <>
              {/* Report Requirements Input */}
              <div className="mb-4">
                <label htmlFor="reportRequirements" className="block text-sm font-medium text-theme-text mb-1">
                  报告生成需求：
                </label>
                <textarea
                  id="reportRequirements"
                  rows={3}
                  className="w-full p-2 border border-theme-blue-dark/50 rounded-md focus:ring-2 focus:ring-theme-blue-DEFAULT focus:border-transparent outline-none"
                  placeholder="例如：总结文档的主要观点，提取关键数据..."
                  value={reportRequirementsInput}
                  onChange={(e) => setReportRequirementsInput(e.target.value)}
                />
              </div>

              {/* File Upload Area */}
              <div className="mb-4">
                <label htmlFor="fileUpload" className="block text-sm font-medium text-theme-text mb-1">
                  上传文档：
                </label>
                <div 
                  id="fileUpload"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 ${isDraggingOver ? 'border-theme-blue-DEFAULT' : 'border-gray-300'} border-dashed rounded-md transition-colors`}
                >
                  <div className="space-y-1 text-center">
                    <svg
                      className="mx-auto h-12 w-12 text-gray-400"
                      stroke="currentColor"
                      fill="none"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <path
                        d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <div className="flex text-sm text-gray-600">
                      <label
                        htmlFor="file-upload-input" // Changed from fileUpload to avoid conflict with div id
                        className="relative cursor-pointer bg-white rounded-md font-medium text-theme-blue-DEFAULT hover:text-theme-blue-light focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-theme-blue-dark"
                      >
                        <span>上传文件</span>
                        <input id="file-upload-input" name="file-upload-input" type="file" className="sr-only" multiple onChange={handleFileSelect} />
                      </label>
                      <p className="pl-1">或拖拽文件到此处</p>
                    </div>
                    <p className="text-xs text-gray-500">支持 PDF, DOCX, TXT 等格式</p>
                  </div>
                </div>
                {/* Display Uploaded Files */} 
                {uploadedFiles.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-sm font-medium text-theme-text mb-1">已选择文件：</h4>
                    <ul className="list-disc list-inside pl-1 space-y-1">
                      {uploadedFiles.map(file => (
                        <li key={file.name} className="text-sm text-gray-700 flex justify-between items-center">
                          <span>{file.name} ({ (file.size / 1024).toFixed(2) } KB)</span>
                          <button 
                            type="button"
                            onClick={() => removeFile(file.name)}
                            className="ml-2 text-red-500 hover:text-red-700 text-xs"
                          >
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              
              <button type='button'
                onClick={(e) => {
                  console.log('[[DEBUG]] Button onClick handler fired!');
                  handleStartAnalysis();
                }}
                disabled={analysisStatus === 'loading' || analysisStatus === 'processing' || !reportRequirementsInput.trim()}
                className={`px-6 py-3 text-lg font-semibold rounded-md shadow-md transition-colors duration-150
                            ${(analysisStatus === 'loading' || analysisStatus === 'processing' || !reportRequirementsInput.trim()) 
                              ? 'bg-gray-400 cursor-not-allowed' 
                              : 'bg-blue-500 text-white hover:bg-theme-blue-light focus:ring-2 focus:ring-theme-blue-dark focus:ring-opacity-50'}
                          `}
              >
                {analysisStatus === 'loading' || analysisStatus === 'processing' ? '正在分析中...' : '开始分析文档'}
              </button>
            </>
          )}
        </section>

        {/* Analysis Result Display */} 
        {analysisStatus === 'success' && (htmlReportContent || analysisResultUrl) && (
          <section className="flex-grow flex flex-col bg-white shadow-lg rounded-lg overflow-hidden border border-theme-blue-dark/50">
            <h2 className="text-xl font-semibold text-theme-text p-4 bg-theme-blue/10 border-b border-theme-blue-dark/30">分析结果</h2>
            {htmlReportContent ? (
              <iframe 
                srcDoc={htmlReportContent} 
                title="分析结果 (内容直显)" 
                className="w-full h-full flex-grow border-none"
              />
            ) : analysisResultUrl ? (
              <iframe 
                src={analysisResultUrl} 
                title="分析结果 (链接加载)" 
                className="w-full h-full flex-grow border-none"
              />
            ) : null}
          </section>
        )}
        
        {/* Loading/Processing Indicator */} 
        {(analysisStatus === 'loading' || analysisStatus === 'processing') && !analysisResultUrl && !htmlReportContent && (
            <div className="text-center py-10">
                <p className="text-theme-text text-xl">请稍候，文档正在分析中...</p>
                {/* Consider adding a spinner here */}
                <svg className="animate-spin h-8 w-8 text-theme-blue-DEFAULT mx-auto mt-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        )}

        {/* Chat Interface - Only show if analysis was successful */} 
        {analysisStatus === 'success' && (
          <section className="mt-auto bg-white/80 backdrop-blur-md p-4 rounded-lg shadow-md border border-theme-blue-dark/30 flex flex-col gap-3">
            <h3 className="text-lg font-semibold text-theme-text mb-2">与我对话：</h3>
            <div ref={chatContainerRef} className="flex-grow max-h-60 overflow-y-auto p-3 space-y-3 bg-theme-blue/5 rounded-md custom-scrollbar">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <span className={`inline-block py-2 px-4 rounded-xl shadow max-w-xs sm:max-w-md lg:max-w-lg break-words 
                                   ${msg.sender === 'user' ? 'bg-theme-blue text-gray-800' : 'bg-gray-200 text-gray-800'}
                                 `}>
                    {msg.text}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input 
                type="text" 
                value={userInput} 
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="基于分析结果提问..." 
                className="flex-grow p-3 border border-theme-blue-dark/50 rounded-lg focus:ring-2 focus:ring-theme-blue-DEFAULT focus:border-transparent outline-none transition-shadow"
                disabled={analysisStatus !== 'success' || userInput === undefined} // Keep disabled state logic
              />
              <button 
                onClick={handleSendMessage}
                className={`px-6 py-3 font-semibold rounded-lg shadow-md transition-colors duration-150
                            ${(!userInput.trim() || analysisStatus !== 'success') 
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                              : 'bg-theme-blue-DEFAULT text-white hover:bg-theme-blue-light focus:ring-2 focus:ring-theme-blue-dark focus:ring-opacity-50'}
                          `}
                disabled={!userInput.trim() || analysisStatus !== 'success'}
              >
                发送
              </button>
            </div>
            {/* Web Search Toggle */}
            <div className="flex items-center mt-3">
              <input
                type="checkbox"
                id="webSearchToggle"
                checked={isWebSearchEnabled}
                onChange={(e) => setIsWebSearchEnabled(e.target.checked)}
                className="w-4 h-4 text-theme-blue-DEFAULT bg-gray-100 border-gray-300 rounded focus:ring-theme-blue-light focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
              />
              <label htmlFor="webSearchToggle" className="ml-2 text-sm font-medium text-theme-text/90 dark:text-gray-300 cursor-pointer">
                联网搜索
              </label>
            </div>
          </section>
        )}
      </main>
    </div>
  );
} 