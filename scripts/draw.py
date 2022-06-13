# -*- coding: utf-8 -*-

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import json

if __name__=='__main__':
    x = [1, 2, 3]
    y = [1, 4, 9]
    f = open('./price.json')
    data = list(json.load(f))
    ys = map(lambda item: item['price'], data)
    xs = map(lambda item: datetime.fromtimestamp(item['timeStamp']), data)
    xfmt = mdates.DateFormatter('%m-%d %H:%M')

    plt.plot(xs, ys)
    plt.title('price of eth/usd')
    ax = plt.gca()
    ax.xaxis.set_major_formatter(xfmt)
    xlocator = mdates.HourLocator(interval=1)
    plt.xticks(rotation=45)
    # xlocator = mdates.MinuteLocator(interval=15)

    # Set xtick labels to appear every 15 minutes
    ax.xaxis.set_major_locator(xlocator);

    plt.ylabel('price')
    plt.show()
