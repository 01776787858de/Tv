import urllib.request
import re
import json
import os
import datetime

FILE_NAME = 'channels.json'
SITE_URL = 'https://www.yallashoot-plus.plus/'

def get_html(url):
    try:
        # التنكر كمتصفح حقيقي لكي لا يحظرنا الموقع
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        response = urllib.request.urlopen(req)
        return response.read().decode('utf-8')
    except Exception as e:
        print(f"خطأ في الاتصال بالموقع: {e}")
        return ""

def extract_streams():
    print(f"جاري فحص الموقع: {SITE_URL}")
    html = get_html(SITE_URL)
    
    # قائمة لحفظ القنوات (المباريات) التي سنجدها
    found_matches = []
    
    # 1. البحث عن روابط صفحات المباريات في الصفحة الرئيسية
    # (هذا التعبير يبحث عن أي رابط داخل الموقع يحتوي على كلمة match أو live أو ينتهي بـ html)
    match_links = re.findall(r'href="(https://www\.yallashoot-plus\.plus/[^"]+\.html)"', html)
    
    # إزالة الروابط المكررة
    match_links = list(set(match_links))
    print(f"تم العثور على {len(match_links)} رابط لمباريات محتملة.")

    # 2. الدخول لكل صفحة مباراة والبحث عن رابط M3U8
    now = datetime.datetime.now().strftime("%H:%M")
    
    for i, link in enumerate(match_links):
        # نكتفي بفحص أول 3 مباريات لتسريع العملية في التجربة
        if i >= 3: break 
        
        print(f"فحص المباراة: {link}")
        match_html = get_html(link)
        
        # البحث السحري عن أي رابط m3u8 داخل صفحة المباراة
        m3u8_match = re.search(r'(https?://[^\s"\'<>]*\.m3u8[^\s"\'<>]*)', match_html)
        
        if m3u8_match:
            stream_url = m3u8_match.group(1)
            print(f"تم العثور على بث: {stream_url}")
            found_matches.append({
                "name": f"⚽ مباراة مباشرة ({now}) - {i+1}",
                "url": stream_url,
                "logo": "https://img.icons8.com/color/48/000000/stadium.png"
            })
            
    return found_matches

# --- بداية التنفيذ ---
new_channels = extract_streams()

if len(new_channels) > 0:
    if os.path.exists(FILE_NAME):
        with open(FILE_NAME, 'r', encoding='utf-8') as f:
            try:
                channels = json.load(f)
            except:
                channels = []
    else:
        channels = []

    # تنظيف المباريات القديمة التي سحبناها سابقاً
    channels = [c for c in channels if "⚽ مباراة مباشرة" not in c.get("name", "")]

    # إضافة المباريات الجديدة في أعلى القائمة
    for match in new_channels:
        channels.insert(0, match)

    # حفظ الملف
    with open(FILE_NAME, 'w', encoding='utf-8') as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)
        
    print(f"تم تحديث المنصة بـ {len(new_channels)} مباريات جديدة!")
else:
    print("لم يتم العثور على روابط M3U8 ظاهرة في المباريات الحالية.")
