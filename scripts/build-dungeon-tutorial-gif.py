#!/usr/bin/env python3
"""Make a looping drawing-order GIF from the repository's original sample.png."""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps

STEPS=(('01 / 04','OUTER CIRCLE'),('02 / 04','INNER CIRCLE'),
       ('03 / 04','ENGLISH SPELL'),('04 / 04','INNER SIGIL'))

def build(source, output):
    image=ImageOps.fit(Image.open(source).convert('RGB'),(320,320),
                       method=Image.Resampling.LANCZOS)
    paper=Image.blend(image.filter(ImageFilter.GaussianBlur(28)),
                      Image.new('RGB',(320,320),'#e7d7b8'),.88)
    frames=[]
    durations=[]
    for step,(number,title) in enumerate(STEPS):
        for tick in range(13):
            progress=min(1.,tick/11.)
            mask=Image.new('L',(320,320))
            pixels=bytearray(320*320)
            for j in range(320*320):
                x=j%320
                y=j//320
                dx=(x-160)/145.6
                dy=(y-160)/145.6
                radius=math.hypot(dx,dy)
                angle=(math.atan2(dy,dx)+math.pi/2)%(2*math.pi)
                bands=(.77<=radius<=1.075,
                       .49<=radius<.77,
                       .49<=radius<=1.075,
                       radius<.49)
                show=((bands[0] and (step>0 or step==0 and angle/(2*math.pi)<=progress))
                      or (bands[1] and (step>1 or step==1 and angle/(2*math.pi)<=progress))
                      or (bands[2] and (step>2 or step==2 and x/320<=progress))
                      or (bands[3] and (step>3 or step==3 and y/320<=progress)))
                pixels[j]=255 if show else 0
            mask.frombytes(bytes(pixels))
            frame=Image.new('RGB',(320,360),'#17151d')
            frame.paste(Image.composite(image,paper,mask),(0,40))
            draw=ImageDraw.Draw(frame)
            draw.text((12,12),number,fill='#e6c78d')
            draw.text((104,12),title,fill='#f7ebd2')
            frames.append(frame.quantize(colors=48,method=Image.Quantize.FASTOCTREE))
            durations.append(480 if tick==12 else 90)
    final=Image.new('RGB',(320,360),'#17151d')
    final.paste(image,(0,40))
    ImageDraw.Draw(final).text((12,12),'MAGIA CIRCLE / DONE',fill='#f7ebd2')
    frames.append(final.quantize(colors=48,method=Image.Quantize.FASTOCTREE))
    durations.append(1900)
    Path(output).parent.mkdir(parents=True,exist_ok=True)
    frames[0].save(output,save_all=True,append_images=frames[1:],
                   duration=durations,loop=0,optimize=True,disposal=2)

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: build-dungeon-tutorial-gif.py sample.png output.gif')
    build(sys.argv[1],sys.argv[2])
