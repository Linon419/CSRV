// 将JSON文件中的时间从中国时区转换为悉尼时区
const fs = require('fs');
const path = require('path');

// 读取JSON文件
const jsonFile = path.join(__dirname, '8～11月潜力区回测记录.json');
const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

console.log(`共有 ${data.length} 条记录需要转换`);

// 转换每条记录的时间
const convertedData = data.map((item, index) => {
  const originalTime = item.time;

  // 解析时间字符串，假设它是中国时区 (UTC+8)
  // 格式: YYYY-MM-DDTHH:mm
  const chinaDate = new Date(originalTime + ':00+08:00'); // 添加秒和中国时区

  // 转换为悉尼时区
  const sydneyTime = chinaDate.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  // 将格式从 "DD/MM/YYYY, HH:mm" 转换为 "YYYY-MM-DDTHH:mm"
  const parts = sydneyTime.split(', ');
  const dateParts = parts[0].split('/');
  const timePart = parts[1];
  const formattedTime = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${timePart}`;

  if (index < 5) {
    console.log(`[${index + 1}] ${item.symbol}: ${originalTime} (中国) -> ${formattedTime} (悉尼)`);
  }

  return {
    ...item,
    time: formattedTime
  };
});

// 保存转换后的数据
const outputFile = path.join(__dirname, '8～11月潜力区回测记录_悉尼时间.json');
fs.writeFileSync(outputFile, JSON.stringify(convertedData, null, 2), 'utf8');

console.log(`\n转换完成！新文件保存为: ${outputFile}`);
console.log(`\n前5条记录已显示，共转换 ${convertedData.length} 条记录`);
